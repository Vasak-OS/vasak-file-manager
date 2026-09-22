mod contrato;
pub mod huerfano;

use crate::utils::normalize_path;
use once_cell::sync::Lazy;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tantivy::collector::TopDocs;
use tantivy::query::{AllQuery, BooleanQuery, FuzzyTermQuery, Query, TermQuery};
use tantivy::schema::{Field, IndexRecordOption, Schema, Value};
use tantivy::{Index, IndexReader, Term};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalSearchQueryOptions {
    pub limit: usize,
    pub include_files: bool,
    pub include_directories: bool,
    pub exact_match: bool,
    pub typo_tolerance: bool,
    pub min_score_threshold: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalSearchResultEntry {
    pub name: String,
    pub ext: Option<String>,
    pub path: String,
    pub size: u64,
    pub item_count: Option<u32>,
    pub modified_time: u64,
    pub accessed_time: u64,
    pub created_time: u64,
    pub mime: Option<String>,
    pub is_file: bool,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_hidden: bool,
    pub score: f32,
}

/// Lo que esta aplicación sabe de un índice que **no** mantiene.
///
/// Todo lo que había acá sobre el escaneo en curso —en qué unidad va, cuántas
/// lleva, si se está confirmando, qué unidades fallaron— se fue con el escaneo.
/// No es que se deje de mostrar: es que este proceso ya no lo sabe, y fingir
/// que sí obligaría a preguntárselo por D-Bus al lanzador, que es justamente el
/// acoplamiento que la decisión de Vasak-OS/vasak-file-manager#75 evitó.
///
/// Lo que queda sale de dos lugares y los dos son archivos: el `status.json`
/// que deja el lanzador y el índice abierto de sólo lectura.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GlobalSearchStatus {
    /// Si hay un escaneo corriendo **según el archivo de estado**, no según
    /// este proceso. Es lo único que se puede saber sin preguntarle a nadie.
    pub is_scan_in_progress: bool,
    pub last_scan_time: Option<u64>,
    pub indexed_item_count: u64,
    pub index_size_bytes: u64,
    pub is_index_valid: bool,
    /// Cómo terminó el último escaneo, tal cual está escrito. Ver `contrato`.
    ///
    /// Va crudo a propósito: la ventana decide qué decir con cada valor, y un
    /// valor que no conozca no puede impedirle leer el resto.
    pub last_scan_state: Option<String>,
    /// Si ese estado es un «en curso» que todavía vale.
    ///
    /// Un escaneo que se muere de golpe deja el «en curso» escrito para
    /// siempre. Sin esto, la ventana diría «indexando» después de un reinicio y
    /// no habría forma de destrabarlo. El vencimiento lo declara el que
    /// escribe, en el propio archivo.
    pub last_scan_is_live: bool,
    /// Que **todavía no hay** índice: el lanzador no escaneó nunca, o no está
    /// instalado.
    ///
    /// Es un estado normal y no un error, y por eso va aparte del campo de
    /// abajo. Mezclados, la primera vez que alguien abre la búsqueda en una
    /// máquina recién instalada le aparece un cartel rojo por algo que no está
    /// roto — y, al revés, un índice que de verdad no se puede abrir le
    /// aparece con el texto «abrí el lanzador», que no lo va a arreglar.
    pub index_missing: bool,
    /// Por qué no se pudo abrir el índice **estando**.
    ///
    /// Esto sí es un problema: hay un directorio y no se entiende. Pasa sobre
    /// todo cuando el esquema es de otra versión del lanzador, y lo que
    /// corresponde es decirlo tal cual —sirve para un informe de error— y no
    /// tragárselo.
    pub index_unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Copy)]
struct GlobalSearchIndexFields {
    path: Field,
    name: Field,
    name_lower: Field,
    is_file: Field,
    is_dir: Field,
    modified_time: Field,
    size: Field,
}

/// El índice abierto, para no reabrirlo en cada tecla.
///
/// Ya no hay estado del escaneo que guardar —lo que se sabe se lee del archivo
/// cada vez que se pregunta—, así que esto es sólo la caché del lector.
struct GlobalSearchState {
    index: Option<Index>,
    reader: Option<IndexReader>,
    fields: Option<GlobalSearchIndexFields>,
}

static GLOBAL_SEARCH_STATE: Lazy<Arc<RwLock<GlobalSearchState>>> = Lazy::new(|| {
    Arc::new(RwLock::new(GlobalSearchState {
        index: None,
        reader: None,
        fields: None,
    }))
});

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_case(value: &str) -> String {
    value.trim().to_lowercase()
}

/// El esquema, del contrato que se comparte con el lanzador.
///
/// Sigue devolviendo la estructura de campos de este módulo para no tocar sus
/// treinta usos: lo que importa es que los **nombres** y las opciones vivan en
/// un solo lugar, que es lo que el otro repositorio tiene que espejar.
fn build_schema() -> (Schema, GlobalSearchIndexFields) {
    let (esquema, campos) = contrato::esquema();
    (
        esquema,
        GlobalSearchIndexFields {
            path: campos.ruta,
            name: campos.nombre,
            name_lower: campos.nombre_minuscula,
            is_file: campos.es_archivo,
            is_dir: campos.es_directorio,
            modified_time: campos.modificado,
            size: campos.tamanio,
        },
    )
}

fn index_dir(base_dir: &Path) -> PathBuf {
    contrato::directorio_del_indice(base_dir)
}

fn calculate_dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }

    let mut total_size: u64 = 0;

    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_file() {
                if let Ok(metadata) = entry.metadata() {
                    total_size += metadata.len();
                }
            } else if entry_path.is_dir() {
                total_size += calculate_dir_size(&entry_path);
            }
        }
    }

    total_size
}

fn meta_file(base_dir: &Path) -> PathBuf {
    contrato::archivo_de_estado(base_dir)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GlobalSearchMeta {
    last_scan_time: Option<u64>,
    indexed_item_count: u64,
    schema_version: u32,
    /// Cómo terminó —o si terminó— el último escaneo. Ver `contrato`.
    ///
    /// Los tres campos que siguen son opcionales porque este archivo lo
    /// escribieron versiones que no los tenían, y un `status.json` viejo tiene
    /// que poder leerse **entero**: si el parseo fallara se perderían también
    /// la versión y la fecha, que sí están. Agregar un campo no puede costar
    /// más que no tenerlo.
    ///
    /// Lo que sostiene eso hoy es el `Option` —serde da `None` cuando falta—;
    /// el `default` está de más mientras lo sean. Se deja igual porque es lo
    /// único que sigue sosteniéndolo el día que alguien haga alguno
    /// obligatorio, que es cuando esto se rompería en silencio para el lector
    /// de enfrente. Comprobado: sin `Option` y sin `default`, un archivo viejo
    /// no se lee.
    #[serde(default)]
    scan_state: Option<String>,
    /// Cuándo se escribió ese estado, en milisegundos desde la época.
    #[serde(default)]
    scan_state_time: Option<u64>,
    /// Cuánto vale ese estado si es «en curso», antes de darlo por muerto.
    #[serde(default)]
    scan_state_ttl_ms: Option<u64>,
}

const SCHEMA_VERSION: u32 = 1;

fn read_meta(base_dir: &Path) -> Option<GlobalSearchMeta> {
    let path = meta_file(base_dir);
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Si lo escrito es un «en curso» que todavía vale.
///
/// Sólo un «en curso» puede estar vivo; los tres estados terminales no. Y uno
/// sin fecha o sin vencimiento no alcanza para decidir nada, así que se lo
/// trata como no vigente en vez de inventarle un criterio: es el lado seguro,
/// el que dice «incompleto» de más y no «indexando» para siempre.
fn estado_en_curso_vigente(meta: &GlobalSearchMeta) -> bool {
    if meta.scan_state.as_deref() != Some(contrato::ESTADO_EN_CURSO) {
        return false;
    }

    match (meta.scan_state_time, meta.scan_state_ttl_ms) {
        (Some(escrito_en), Some(vence_en)) => {
            contrato::en_curso_sigue_vivo(escrito_en, vence_en, now_millis())
        }
        _ => false,
    }
}

/// Abre el índice para **leerlo**, y nada más.
///
/// # Por qué no crea y sobre todo por qué no descarta
///
/// Lo que había antes era `open_or_create_index`, y hacía las dos cosas: si no
/// existía lo creaba, y si el esquema guardado no era el suyo **borraba el
/// directorio entero** y lo rehacía. Tenía sentido cuando el índice era de esta
/// aplicación. Desde que lo mantiene `vasak-prism` es lo peor que podría hacer:
/// la llamaba `global_search_query`, o sea que **escribir en el campo de
/// búsqueda podía borrar el índice del lanzador**.
///
/// Y no fallaría de forma visible. El lanzador lo rehace en cuanto alguien lo
/// abre, este lado lo vuelve a descartar en la siguiente búsqueda, y los dos se
/// quedan recorriendo el disco entero para siempre. Nadie ve un error: se ve un
/// escritorio que muele disco sin motivo.
///
/// Acá no hay ninguna decisión que tomar sobre el índice ajeno. O está y se
/// puede abrir, o no hay resultados. Que no esté es normal —el lanzador todavía
/// no escaneó, o no está instalado— y se dice en el estado, no acá.
fn abrir_para_leer(
    index_path: &Path,
) -> Result<(Index, IndexReader, GlobalSearchIndexFields), String> {
    let (esquema, fields) = build_schema();

    let index = Index::open_in_dir(index_path)
        .map_err(|error| format!("no se pudo abrir el índice de búsqueda: {error}"))?;

    // El esquema se comprueba y se **rechaza**, no se arregla. Si no coincide,
    // lo escribió una versión del lanzador que no es ésta: consultarlo daría
    // campos que no existen o, peor, campos con el mismo nombre y otro
    // significado. Decirlo es lo único correcto; tocarlo es de quien escribe.
    if index.schema() != esquema {
        return Err(
            "el índice de búsqueda es de otra versión del esquema; lo rehace vasak-prism"
                .to_string(),
        );
    }

    let reader = index
        .reader_builder()
        .try_into()
        .map_err(|error: tantivy::TantivyError| error.to_string())?;

    Ok((index, reader, fields))
}

/// Lo que se sabe del índice, que lo mantiene otro.
///
/// Antes esto abría el índice, lo creaba si faltaba y lo vaciaba si no valía.
/// Ahora sólo mira: lee el `status.json` que deja `vasak-prism` y abre el
/// índice de sólo lectura si está. No escanear también significa no tener nada
/// que arrancar — el nombre se queda porque es lo que la ventana llama al
/// abrirse, y lo que hace ahora es enterarse.
#[tauri::command]
pub fn global_search_init() -> Result<GlobalSearchStatus, String> {
    global_search_get_status()
}

fn calculate_similarity_score(query: &str, name: &str) -> f32 {
    let query_lower = query.to_lowercase();
    let name_lower = name.to_lowercase();

    if name_lower == query_lower {
        return 1.0;
    }

    if name_lower.starts_with(&query_lower) {
        return 0.95 + (query_lower.len() as f32 / name_lower.len() as f32) * 0.05;
    }

    if name_lower.contains(&query_lower) {
        return 0.8 + (query_lower.len() as f32 / name_lower.len() as f32) * 0.15;
    }

    let query_tokens: Vec<&str> = query_lower
        .split(|c: char| c.is_whitespace() || c == '.' || c == '_' || c == '-')
        .filter(|s| !s.is_empty())
        .collect();

    let name_tokens: Vec<&str> = name_lower
        .split(|c: char| c.is_whitespace() || c == '.' || c == '_' || c == '-')
        .filter(|s| !s.is_empty())
        .collect();

    if !query_tokens.is_empty() && !name_tokens.is_empty() {
        let mut matched_count = 0;
        let mut partial_match_score = 0.0f32;

        for query_token in &query_tokens {
            let mut best_token_score = 0.0f32;

            for name_token in &name_tokens {
                if *name_token == *query_token {
                    best_token_score = 1.0;
                    break;
                } else if name_token.starts_with(query_token) {
                    best_token_score = best_token_score.max(0.9);
                } else if name_token.contains(query_token) {
                    best_token_score = best_token_score.max(0.8);
                } else {
                    let q_chars: Vec<char> = query_token.chars().collect();
                    let n_chars: Vec<char> = name_token.chars().collect();
                    if !q_chars.is_empty() && !n_chars.is_empty() {
                        let dist = levenshtein_distance(&q_chars, &n_chars);
                        let max_len = q_chars.len().max(n_chars.len());
                        if dist <= 2 && max_len > 0 {
                            let sim = 1.0 - (dist as f32 / max_len as f32);
                            best_token_score = best_token_score.max(sim * 0.7);
                        }
                    }
                }
            }

            if best_token_score > 0.5 {
                matched_count += 1;
            }
            partial_match_score += best_token_score;
        }

        let match_ratio = matched_count as f32 / query_tokens.len() as f32;
        let avg_token_score = partial_match_score / query_tokens.len() as f32;

        if match_ratio >= 0.5 {
            return 0.6 + (match_ratio * 0.2) + (avg_token_score * 0.15);
        }
    }

    let query_chars: Vec<char> = query_lower.chars().collect();
    let name_chars: Vec<char> = name_lower.chars().collect();

    if query_chars.is_empty() || name_chars.is_empty() {
        return 0.0;
    }

    let distance = levenshtein_distance(&query_chars, &name_chars);
    let max_len = query_chars.len().max(name_chars.len()) as f32;
    let similarity = 1.0 - (distance as f32 / max_len);

    similarity.max(0.0)
}

fn levenshtein_distance(s1: &[char], s2: &[char]) -> usize {
    let len1 = s1.len();
    let len2 = s2.len();

    if len1 == 0 {
        return len2;
    }
    if len2 == 0 {
        return len1;
    }

    let mut prev_row: Vec<usize> = (0..=len2).collect();
    let mut curr_row: Vec<usize> = vec![0; len2 + 1];

    for row_idx in 1..=len1 {
        curr_row[0] = row_idx;

        for col_idx in 1..=len2 {
            let cost = if s1[row_idx - 1] == s2[col_idx - 1] {
                0
            } else {
                1
            };

            curr_row[col_idx] = (prev_row[col_idx] + 1)
                .min(curr_row[col_idx - 1] + 1)
                .min(prev_row[col_idx - 1] + cost);
        }

        std::mem::swap(&mut prev_row, &mut curr_row);
    }

    prev_row[len2]
}

fn get_min_score_for_query_length(query_len: usize) -> f32 {
    match query_len {
        1..=3 => 0.9,
        4..=6 => 0.65,
        7..=9 => 0.55,
        _ => 0.5,
    }
}

fn build_query(
    fields: &GlobalSearchIndexFields,
    query: &str,
    options: &GlobalSearchQueryOptions,
) -> Box<dyn Query> {
    let normalized = normalize_case(query);

    if normalized.is_empty() {
        return Box::new(AllQuery);
    }

    if options.exact_match {
        let term = Term::from_field_text(fields.name_lower, &normalized);
        return Box::new(TermQuery::new(term, IndexRecordOption::Basic));
    }

    let words: Vec<String> = normalized
        .split(|c: char| c.is_whitespace() || c == '.' || c == '_' || c == '-')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    let max_distance = if options.typo_tolerance { 2 } else { 1 };

    let mut subqueries: Vec<(tantivy::query::Occur, Box<dyn Query>)> = Vec::new();

    for word in &words {
        let term = Term::from_field_text(fields.name, word);
        let fuzzy = FuzzyTermQuery::new(term, max_distance, true);
        subqueries.push((tantivy::query::Occur::Should, Box::new(fuzzy)));
    }

    let whitespace_words: Vec<&str> = normalized.split_whitespace().collect();
    for word in whitespace_words {
        if word.contains('.') || word.contains('_') || word.contains('-') {
            let term = Term::from_field_text(fields.name, word);
            let fuzzy = FuzzyTermQuery::new(term, max_distance, true);
            subqueries.push((tantivy::query::Occur::Should, Box::new(fuzzy)));
        }
    }

    Box::new(BooleanQuery::from(subqueries))
}

fn matches_type(doc_is_file: u64, doc_is_dir: u64, options: &GlobalSearchQueryOptions) -> bool {
    let is_file = doc_is_file == 1;
    let is_dir = doc_is_dir == 1;

    (options.include_files && is_file) || (options.include_directories && is_dir)
}

/// Lo que se sabe del índice, leído del disco cada vez.
///
/// Antes esto devolvía una copia de lo que el propio escaneo había ido dejando
/// en memoria. Ahora el escaneo es de otro proceso, así que lo que hay en
/// memoria no se entera de nada: si el lanzador escanea mientras esta ventana
/// está abierta, la única forma de verlo es volver a mirar el archivo.
///
/// Son dos lecturas chicas —un JSON de cien bytes y el tamaño de un directorio
/// plano—, y se hacen cuando la ventana pregunta, no por tecla.
#[tauri::command]
pub fn global_search_get_status() -> Result<GlobalSearchStatus, String> {
    let Some(base_dir) = contrato::base_de_cache() else {
        return Ok(GlobalSearchStatus {
            index_unavailable_reason: Some("no se pudo determinar el directorio de caché".into()),
            ..Default::default()
        });
    };
    let index_path = index_dir(&base_dir);
    let meta = read_meta(&base_dir);

    let mut estado = GlobalSearchStatus {
        last_scan_time: meta.as_ref().and_then(|m| m.last_scan_time),
        index_size_bytes: calculate_dir_size(&index_path),
        last_scan_state: meta.as_ref().and_then(|m| m.scan_state.clone()),
        last_scan_is_live: meta.as_ref().is_some_and(estado_en_curso_vigente),
        ..Default::default()
    };
    estado.is_scan_in_progress = estado.last_scan_is_live;

    // El conteo sale del índice y no del archivo de estado. Los dos lo traen,
    // y cuando no coinciden el que manda es el índice: el archivo dice cuántas
    // entradas dejó el último escaneo y el índice dice cuántas hay para buscar,
    // que es lo que la ventana está por decirle a alguien.
    // Los dos casos se separan **acá**, mirando el disco, y no interpretando
    // el texto del error más abajo: «no está» y «está y no se entiende» se
    // arreglan de formas distintas y el que mira tiene que poder distinguirlos.
    if !index_path.is_dir() {
        estado.index_missing = true;
        return Ok(estado);
    }

    match abrir_para_leer(&index_path) {
        Ok((_, reader, _)) => {
            estado.indexed_item_count = reader.searcher().num_docs();
            estado.is_index_valid = estado.indexed_item_count > 0
                && meta
                    .as_ref()
                    .is_some_and(|m| m.schema_version == SCHEMA_VERSION);
        }
        Err(motivo) => estado.index_unavailable_reason = Some(motivo),
    }

    Ok(estado)
}

#[tauri::command]
pub async fn global_search_query(
    query: String,
    options: GlobalSearchQueryOptions,
) -> Result<Vec<GlobalSearchResultEntry>, String> {
    let base_dir = contrato::base_de_cache()
        .ok_or_else(|| "Could not determine the user cache directory".to_string())?;
    let index_path = index_dir(&base_dir);

    let (_index, reader, fields) = {
        let mut state = GLOBAL_SEARCH_STATE
            .write()
            .map_err(|error| error.to_string())?;
        // Se toman los valores en la misma expresión que los pone, en lugar de
        // volver a desenvolverlos después.
        //
        // Los tres `unwrap` que había eran correctos sólo porque el `if` de
        // arriba garantizaba que estuvieran: cualquier cambio en esa condición
        // los convertía en un panic. Así el compilador lo garantiza.
        match (&state.index, &state.reader, &state.fields) {
            (Some(index), Some(reader), Some(fields)) => (index.clone(), reader.clone(), *fields),
            _ => {
                let (index, reader, fields) = abrir_para_leer(&index_path)?;
                let listo = (index.clone(), reader.clone(), fields);
                state.index = Some(index);
                state.reader = Some(reader);
                state.fields = Some(fields);
                listo
            }
        }
    };

    let searcher = reader.searcher();
    let normalized_query = normalize_case(&query);

    let q = build_query(&fields, &query, &options);
    let top_docs = searcher
        .search(&q, &TopDocs::with_limit(100_000))
        .map_err(|error| error.to_string())?;

    // Acá se volvían a filtrar las rutas excluidas, con una copia de la lista
    // que usaba el escaneo. Se va con el escaneo, y no sólo porque sobre: el
    // índice sólo tiene lo que su dueño decidió indexar, así que filtrarlo otra
    // vez es discutirle al dueño con una lista que ya no se actualiza junto con
    // la suya.
    //
    // Y no es teórico. El lanzador arregló la lista —`/dev` y compañía valían
    // como segmento en cualquier nivel, así que `~/proyectos/dev` quedaba
    // afuera— y ahora la indexa. Con la copia vieja acá, esos archivos estarían
    // en el índice y **esta ventana no los mostraría igual**: el arreglo se
    // vería en el lanzador y no acá, por una lista que nadie recordaría mirar.
    let min_score = options
        .min_score_threshold
        .unwrap_or_else(|| get_min_score_for_query_length(normalized_query.len()));

    let results: Vec<GlobalSearchResultEntry> = top_docs
        .par_iter()
        .filter_map(|(_tantivy_score, doc_address)| {
            let retrieved: tantivy::TantivyDocument = searcher.doc(*doc_address).ok()?;

            let path_value = retrieved
                .get_first(fields.path)
                .and_then(|value| value.as_str())?
                .to_string();

            let name_value = retrieved
                .get_first(fields.name)
                .and_then(|value| value.as_str())?
                .to_string();

            let name_score = calculate_similarity_score(&normalized_query, &name_value);

            if name_score < min_score {
                return None;
            }

            let doc_is_file = retrieved
                .get_first(fields.is_file)
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            let doc_is_dir = retrieved
                .get_first(fields.is_dir)
                .and_then(|value| value.as_u64())
                .unwrap_or(0);

            if !matches_type(doc_is_file, doc_is_dir, &options) {
                return None;
            }

            let modified_time = retrieved
                .get_first(fields.modified_time)
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            let size = retrieved
                .get_first(fields.size)
                .and_then(|value| value.as_u64())
                .unwrap_or(0);

            let ext = Path::new(&path_value)
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.to_lowercase());

            // Con el mismo tipo de contenido que en el listado: es de donde sale
            // el icono, y un resultado de búsqueda sin él caería en la hoja en
            // blanco mientras el mismo archivo, visto en su carpeta, sale bien.
            let mime =
                crate::tipo_de_contenido::por_el_nombre(Path::new(&path_value), doc_is_file == 1);

            Some(GlobalSearchResultEntry {
                name: name_value,
                ext,
                path: path_value,
                size,
                item_count: None,
                modified_time,
                accessed_time: 0,
                created_time: 0,
                mime,
                is_file: doc_is_file == 1,
                is_dir: doc_is_dir == 1,
                is_symlink: false,
                is_hidden: false,
                score: name_score,
            })
        })
        .collect();

    let mut drive_groups: std::collections::HashMap<String, Vec<GlobalSearchResultEntry>> =
        std::collections::HashMap::new();

    for entry in results {
        let drive_root = get_drive_root(&entry.path);
        drive_groups.entry(drive_root).or_default().push(entry);
    }

    let mut final_results: Vec<GlobalSearchResultEntry> = Vec::new();
    for (_drive, mut entries) in drive_groups {
        entries.par_sort_by(|entry_a, entry_b| {
            entry_b
                .score
                .partial_cmp(&entry_a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        entries.truncate(options.limit);
        final_results.extend(entries);
    }

    final_results.par_sort_by(|entry_a, entry_b| {
        entry_b
            .score
            .partial_cmp(&entry_a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(final_results)
}

#[tauri::command]
pub async fn global_search_query_paths(
    paths: Vec<String>,
    query: String,
    options: GlobalSearchQueryOptions,
) -> Result<Vec<GlobalSearchResultEntry>, String> {
    if paths.is_empty() || query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let normalized_query = normalize_case(&query);
    let min_score = get_min_score_for_query_length(normalized_query.len());

    let all_searchable_paths: Vec<PathBuf> = paths
        .par_iter()
        .flat_map(|path_string| {
            let path = Path::new(path_string);
            let mut collected_paths = Vec::new();

            if let Ok(metadata) = std::fs::metadata(path) {
                if metadata.is_dir() {
                    if let Ok(entries) = std::fs::read_dir(path) {
                        for entry_result in entries.flatten() {
                            collected_paths.push(entry_result.path());
                        }
                    }
                } else {
                    collected_paths.push(path.to_path_buf());
                }
            }

            collected_paths
        })
        .collect();

    let results: Vec<GlobalSearchResultEntry> = all_searchable_paths
        .par_iter()
        .filter_map(|path| {
            let name = path.file_name().and_then(|n| n.to_str())?.to_string();

            let name_score = calculate_similarity_score(&normalized_query, &name);

            if name_score < min_score {
                return None;
            }

            let metadata = std::fs::metadata(path).ok()?;

            let is_file = metadata.is_file();
            let is_dir = metadata.is_dir();

            if !matches_type(
                if is_file { 1 } else { 0 },
                if is_dir { 1 } else { 0 },
                &options,
            ) {
                return None;
            }

            let modified_time = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);

            let accessed_time = metadata
                .accessed()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);

            let created_time = metadata
                .created()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);

            let size = if is_file { metadata.len() } else { 0 };

            let ext = path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.to_lowercase());

            let path_string = path.to_string_lossy().to_string();
            let normalized_path = normalize_path(&path_string);

            Some(GlobalSearchResultEntry {
                name,
                ext,
                path: normalized_path,
                size,
                item_count: None,
                modified_time,
                accessed_time,
                created_time,
                mime: crate::tipo_de_contenido::por_el_nombre(path, is_file),
                is_file,
                is_dir,
                is_symlink: metadata.is_symlink(),
                is_hidden: is_hidden_path(path),
                score: name_score,
            })
        })
        .collect();

    let mut sorted_results = results;
    sorted_results.par_sort_by(|entry_a, entry_b| {
        entry_b
            .score
            .partial_cmp(&entry_a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    if sorted_results.len() > options.limit {
        sorted_results.truncate(options.limit);
    }

    Ok(sorted_results)
}

fn is_hidden_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
            return (metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN) != 0;
        }
        false
    }
    #[cfg(not(windows))]
    {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with('.'))
            .unwrap_or(false)
    }
}

fn get_drive_root(path: &str) -> String {
    #[cfg(windows)]
    {
        if path.len() >= 3 && path.chars().nth(1) == Some(':') {
            return path[..3].to_uppercase();
        }
    }
    #[cfg(not(windows))]
    {
        let parts: Vec<&str> = path.split('/').collect();
        if parts.len() >= 2 && parts[0].is_empty() {
            return format!("/{}", parts[1]);
        }
    }
    "/".to_string()
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use tantivy::doc;

    /// El vencimiento que declara `vasak-prism` al escribir un «en curso».
    ///
    /// Acá es sólo para armar los casos: este lado ya no lo declara, lo lee del
    /// propio archivo. Tenerlo como constante propia sería volver a la
    /// situación que el campo vino a evitar — dos programas diciendo cosas
    /// distintas sobre el mismo estado.
    const VENCIMIENTO_DE_EJEMPLO: u64 = 30 * 60 * 1000;

    /// Un directorio propio que se borra al salir del alcance.
    ///
    /// Hecho a mano para no sumar una dependencia por una prueba: el nombre
    /// lleva el pid y un número que sube, así que dos pruebas en paralelo no se
    /// pisan.
    struct DirectorioDePrueba(PathBuf);

    impl DirectorioDePrueba {
        fn nuevo(nombre: &str) -> Self {
            let ruta = std::env::temp_dir().join(format!(
                "vasak-file-manager-{}-{}-{nombre}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&ruta).unwrap();
            Self(ruta)
        }
    }

    impl Drop for DirectorioDePrueba {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Deja un índice con un documento adentro y devuelve con qué leerlo.
    fn indice_con_un_documento(ruta: &Path) -> (Index, IndexReader) {
        let (esquema, campos) = build_schema();
        let index = Index::create_in_dir(ruta, esquema).unwrap();

        let mut writer: tantivy::IndexWriter = index.writer(15_000_000).unwrap();
        writer
            .add_document(doc!(
                campos.path => "/casa/informe.pdf",
                campos.name => "informe.pdf",
                campos.name_lower => "informe.pdf",
                campos.is_file => 1u64,
                campos.is_dir => 0u64,
                campos.modified_time => 0u64,
                campos.size => 0u64,
            ))
            .unwrap();
        writer.commit().unwrap();

        let reader: IndexReader = index.reader_builder().try_into().unwrap();
        (index, reader)
    }

    #[test]
    fn un_estado_viejo_sin_los_campos_nuevos_se_sigue_leyendo_entero() {
        // Lo que escribió una versión anterior no tiene `scan_state` ni sus dos
        // acompañantes. Si eso hiciera fallar el parseo, agregar el campo
        // costaría **más** que no tenerlo: se perderían también la versión y la
        // fecha, que sí están ahí.
        //
        // Quien sostiene esto hoy es el `Option`, no el `default`: sacar el
        // `default` deja la prueba en verde, y por eso no alcanza como
        // comprobación al revés. Lo que sí la hace fallar es volver el campo
        // obligatorio y sin `default`, que es el cambio que hay que evitar.
        let directorio = DirectorioDePrueba::nuevo("estado-viejo");
        let archivo = contrato::archivo_de_estado(&directorio.0);
        std::fs::create_dir_all(archivo.parent().unwrap()).unwrap();
        std::fs::write(
            &archivo,
            r#"{"last_scan_time":1700000000000,"indexed_item_count":42,"schema_version":1}"#,
        )
        .unwrap();

        let leido = read_meta(&directorio.0).expect("un estado viejo tiene que poder leerse");

        assert_eq!(leido.last_scan_time, Some(1_700_000_000_000));
        assert_eq!(leido.indexed_item_count, 42);
        assert_eq!(leido.schema_version, 1);
        assert_eq!(
            leido.scan_state, None,
            "falta el campo, que no es lo mismo que un valor desconocido"
        );
    }

    /// Deja un índice con un esquema que no es el nuestro.
    fn indice_de_otro_esquema(ruta: &Path) {
        let mut otro = Schema::builder();
        otro.add_text_field("otra_cosa", tantivy::schema::STRING);
        Index::create_in_dir(ruta, otro.build()).unwrap();
    }

    #[test]
    fn abrir_para_leer_no_borra_un_indice_que_no_entiende() {
        // La prueba más importante de este archivo.
        //
        // Lo que había antes descartaba el directorio entero cuando el esquema
        // no era el suyo, y lo llamaba `global_search_query`: escribir en el
        // campo de búsqueda **borraba el índice del lanzador**. Y no se vería
        // como un fallo — el lanzador lo rehace, esta ventana lo vuelve a
        // borrar en la siguiente búsqueda, y los dos quedan recorriendo el
        // disco para siempre sin que nada lo diga.
        //
        // El índice es de otro programa. Acá no hay nada que arreglar.
        let directorio = DirectorioDePrueba::nuevo("otro-esquema");
        indice_de_otro_esquema(&directorio.0);

        let antes: Vec<_> = std::fs::read_dir(&directorio.0)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name()))
            .collect();
        assert!(!antes.is_empty(), "el índice ajeno tiene archivos");

        assert!(
            abrir_para_leer(&directorio.0).is_err(),
            "un esquema que no es el nuestro se rechaza"
        );

        let despues: Vec<_> = std::fs::read_dir(&directorio.0)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name()))
            .collect();
        assert_eq!(
            antes.len(),
            despues.len(),
            "y no se toca ni un archivo del índice ajeno"
        );
    }

    #[test]
    fn abrir_para_leer_no_crea_un_indice_donde_no_hay() {
        // Crear uno vacío sería peor que no tener ninguno: el lanzador vería un
        // índice donde no había nada, y quien busca vería cero resultados en
        // lugar de «todavía no hay índice».
        let directorio = DirectorioDePrueba::nuevo("sin-indice");
        let vacio = directorio.0.join("no-esta");

        assert!(abrir_para_leer(&vacio).is_err());
        assert!(!vacio.exists(), "no se crea nada");
    }

    #[test]
    fn un_indice_que_si_es_el_nuestro_se_abre_y_se_lee() {
        // La otra mitad: rechazar todo también pasaría las dos de arriba.
        let directorio = DirectorioDePrueba::nuevo("indice-bueno");
        let _vivo = indice_con_un_documento(&directorio.0);

        let (_, lector, _) = abrir_para_leer(&directorio.0).expect("tiene que abrirse");
        assert_eq!(lector.searcher().num_docs(), 1);
    }

    /// Un estado con los tres campos puestos, para las pruebas de vigencia.
    fn meta_con(estado: &str, escrito_en: u64, vence_en: u64) -> GlobalSearchMeta {
        GlobalSearchMeta {
            last_scan_time: None,
            indexed_item_count: 0,
            schema_version: SCHEMA_VERSION,
            scan_state: Some(estado.to_string()),
            scan_state_time: Some(escrito_en),
            scan_state_ttl_ms: Some(vence_en),
        }
    }

    #[test]
    fn solo_un_en_curso_puede_estar_vigente() {
        let ahora = now_millis();

        assert!(estado_en_curso_vigente(&meta_con(
            contrato::ESTADO_EN_CURSO,
            ahora,
            VENCIMIENTO_DE_EJEMPLO
        )));

        // Los tres terminales no, por recientes que sean: ya terminaron.
        for terminal in [
            contrato::ESTADO_COMPLETO,
            contrato::ESTADO_CANCELADO,
            contrato::ESTADO_FALLADO,
        ] {
            assert!(
                !estado_en_curso_vigente(&meta_con(terminal, ahora, VENCIMIENTO_DE_EJEMPLO)),
                "«{terminal}» ya terminó, no puede estar en curso"
            );
        }
    }

    #[test]
    fn un_en_curso_sin_con_que_decidir_no_se_da_por_vivo() {
        // Sin fecha o sin vencimiento no hay criterio, y ahí hay que elegir un
        // lado. Se elige «no vigente»: cuesta un «incompleto» de más, mientras
        // que darlo por vivo deja un «indexando» que nadie puede destrabar.
        let ahora = now_millis();

        let mut sin_fecha = meta_con(contrato::ESTADO_EN_CURSO, ahora, VENCIMIENTO_DE_EJEMPLO);
        sin_fecha.scan_state_time = None;
        assert!(!estado_en_curso_vigente(&sin_fecha));

        let mut sin_vencimiento =
            meta_con(contrato::ESTADO_EN_CURSO, ahora, VENCIMIENTO_DE_EJEMPLO);
        sin_vencimiento.scan_state_ttl_ms = None;
        assert!(!estado_en_curso_vigente(&sin_vencimiento));
    }

    #[test]
    fn un_en_curso_de_un_escaneo_que_murio_deja_de_estar_vigente() {
        // El caso del reinicio: el proceso que lo escribió ya no está, pero el
        // archivo sigue diciendo «en curso».
        let hace_mucho = now_millis() - VENCIMIENTO_DE_EJEMPLO - 1;

        assert!(!estado_en_curso_vigente(&meta_con(
            contrato::ESTADO_EN_CURSO,
            hace_mucho,
            VENCIMIENTO_DE_EJEMPLO
        )));
    }
}
