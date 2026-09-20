//! El contrato del índice: dónde está y cómo se llama cada campo.
//!
//! Esto no es un detalle interno de la búsqueda global. Es lo **único** que
//! comparten dos programas que no comparten código: el gestor de archivos, que
//! escribe el índice, y `vasak-prism`, que lo abre de sólo lectura para su
//! proveedor de archivos. El lanzador tiene estas mismas constantes escritas a
//! mano en su lado.
//!
//! # Por qué importa tanto para algo tan chico
//!
//! Porque romperlo no falla. Si acá se renombra un campo o se mueve el
//! directorio, el lanzador sigue compilando, sigue arrancando y simplemente
//! deja de encontrar archivos: una lista vacía, que es indistinguible de «no
//! hay nada que coincida». No hay error, no hay registro, no hay nada que
//! mirar.
//!
//! Por eso los nombres están en constantes y no sueltos en la llamada, y por
//! eso hay una prueba que los fija: para que cambiarlos sea un acto deliberado
//! que rompe algo visible acá, y no un renombre que alguien hace de paso.
//!
//! # Esto se va a mover
//!
//! El dueño del índice pasa a ser el lanzador —Vasak-OS/vasak-file-manager#75 y
//! Vasak-OS/vasak-prism#33—: él escanea y escribe, y el gestor pasa a leer. Lo
//! que hoy está acá es lo que va a viajar; el resto de `global_search.rs` se
//! parte en la mitad que escribe, que se va, y la que consulta, que se queda.

use std::path::{Path, PathBuf};
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, FAST, STORED, STRING,
};

/// La ruta completa del archivo, tal cual, para poder abrirlo.
pub const CAMPO_RUTA: &str = "path";
/// El nombre, tokenizado, que es contra lo que se busca.
pub const CAMPO_NOMBRE: &str = "name";
/// El nombre en minúsculas, para comparar sin importar cómo se escribió.
pub const CAMPO_NOMBRE_MINUSCULA: &str = "name_lower";
/// Si es un archivo. Va como número porque tantivy no tiene booleanos.
pub const CAMPO_ES_ARCHIVO: &str = "is_file";
/// Si es un directorio.
pub const CAMPO_ES_DIRECTORIO: &str = "is_dir";
/// Cuándo se modificó, en milisegundos desde la época.
pub const CAMPO_MODIFICADO: &str = "modified_time";
/// El tamaño en bytes.
pub const CAMPO_TAMANIO: &str = "size";

/// El subdirectorio donde vive todo lo de la búsqueda global.
pub const DIRECTORIO: &str = "global-search";
/// El índice propiamente dicho, adentro de ése.
pub const INDICE: &str = "index";
/// Lo que se sabe del último escaneo, al lado del índice.
pub const ESTADO: &str = "status.json";

/// Los campos del esquema, ya resueltos contra un índice abierto.
///
/// Tantivy identifica los campos por un número que asigna al construir el
/// esquema, no por su nombre, así que hay que quedarse con ellos.
#[derive(Debug, Clone)]
pub struct Campos {
    pub ruta: Field,
    pub nombre: Field,
    pub nombre_minuscula: Field,
    pub es_archivo: Field,
    pub es_directorio: Field,
    pub modificado: Field,
    pub tamanio: Field,
}

/// El esquema del índice, y sus campos.
///
/// Tiene que dar exactamente lo mismo de los dos lados: un campo declarado
/// `STRING` de un lado y `TEXT` del otro no es el mismo campo, aunque se llame
/// igual, y la consulta no encuentra nada.
pub fn esquema() -> (Schema, Campos) {
    let mut constructor = Schema::builder();

    // El nombre va con frecuencias y posiciones porque es contra lo que se
    // busca de verdad, con tolerancia a errores de tipeo.
    let indexado_del_nombre = TextFieldIndexing::default()
        .set_tokenizer("default")
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    let opciones_del_nombre = TextOptions::default()
        .set_indexing_options(indexado_del_nombre)
        .set_stored();

    let ruta = constructor.add_text_field(CAMPO_RUTA, STRING | STORED);
    let nombre = constructor.add_text_field(CAMPO_NOMBRE, opciones_del_nombre);
    let nombre_minuscula = constructor.add_text_field(CAMPO_NOMBRE_MINUSCULA, STRING | STORED);

    let es_archivo = constructor.add_u64_field(CAMPO_ES_ARCHIVO, FAST | STORED);
    let es_directorio = constructor.add_u64_field(CAMPO_ES_DIRECTORIO, FAST | STORED);
    let modificado = constructor.add_u64_field(CAMPO_MODIFICADO, FAST | STORED);
    let tamanio = constructor.add_u64_field(CAMPO_TAMANIO, FAST | STORED);

    let esquema = constructor.build();
    (
        esquema,
        Campos {
            ruta,
            nombre,
            nombre_minuscula,
            es_archivo,
            es_directorio,
            modificado,
            tamanio,
        },
    )
}

/// Dónde vive el índice, a partir del directorio de datos de la aplicación.
pub fn directorio_del_indice(base: &Path) -> PathBuf {
    base.join(DIRECTORIO).join(INDICE)
}

/// Dónde vive lo que se sabe del último escaneo.
pub fn archivo_de_estado(base: &Path) -> PathBuf {
    base.join(DIRECTORIO).join(ESTADO)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use tantivy::schema::FieldType;

    #[test]
    fn los_nombres_de_los_campos_no_se_tocan() {
        // Son la mitad del contrato con `vasak-prism`, que los tiene escritos a
        // mano de su lado. Renombrar uno acá lo deja sin encontrar archivos, y
        // sin ningún error: una lista vacía.
        //
        // Si esta prueba molesta porque el esquema **tiene** que cambiar, el
        // cambio es deliberado y va con el del otro repositorio en la misma
        // tanda. De eso se trata.
        let (esquema, _) = esquema();
        let nombres: Vec<&str> = esquema.fields().map(|(_, e)| e.name()).collect();

        assert_eq!(
            nombres,
            vec![
                "path",
                "name",
                "name_lower",
                "is_file",
                "is_dir",
                "modified_time",
                "size"
            ]
        );
    }

    #[test]
    fn la_ruta_del_indice_tampoco() {
        // La otra mitad. El lanzador la arma con esta misma forma, colgando del
        // directorio de datos del gestor.
        let base = Path::new("/casa/.local/share/ar.net.vasak.vasak-file-manager");

        assert_eq!(
            directorio_del_indice(base),
            Path::new("/casa/.local/share/ar.net.vasak.vasak-file-manager/global-search/index")
        );
        assert_eq!(
            archivo_de_estado(base),
            Path::new(
                "/casa/.local/share/ar.net.vasak.vasak-file-manager/global-search/status.json"
            )
        );
    }

    #[test]
    fn el_nombre_se_indexa_distinto_de_la_ruta() {
        // No alcanza con que los nombres coincidan: dos campos que se llamen
        // igual pero estén indexados distinto no son el mismo campo, y la
        // consulta no encuentra nada.
        //
        // Lo que los distingue es con cuánto detalle se indexa cada uno. El
        // nombre va con frecuencias y posiciones, que es lo que la búsqueda
        // difusa necesita; la ruta va en `Basic`, entera y sin tokenizar,
        // porque es para abrir el archivo y no para buscar dentro.
        //
        // Se comprobó contra la biblioteca antes de escribirlo: `has_fieldnorms`
        // es `true` en los dos, así que no sirve para distinguirlos. La primera
        // versión de esta prueba daba por sentado que no, y fallaba.
        let (esquema, campos) = esquema();

        assert_eq!(
            esquema
                .get_field_entry(campos.nombre)
                .field_type()
                .get_index_record_option(),
            Some(IndexRecordOption::WithFreqsAndPositions),
            "el nombre es contra lo que se busca"
        );
        assert_eq!(
            esquema
                .get_field_entry(campos.ruta)
                .field_type()
                .get_index_record_option(),
            Some(IndexRecordOption::Basic),
            "la ruta va entera"
        );
    }

    /// Con qué tokenizador se indexa un campo de texto.
    ///
    /// No hay atajo en `FieldType` para esto —sí lo hay para el detalle de
    /// indexado—, así que hay que bajar hasta las opciones de texto.
    fn tokenizador(esquema: &Schema, campo: Field) -> Option<&str> {
        match esquema.get_field_entry(campo).field_type() {
            FieldType::Str(opciones) => opciones.get_indexing_options().map(|o| o.tokenizer()),
            _ => None,
        }
    }

    #[test]
    fn el_tokenizador_de_cada_campo_tampoco_se_toca() {
        // El detalle de indexado y el tokenizador son dos cosas separadas, y la
        // prueba de arriba sólo fija la primera. Quien cambie el tokenizador de
        // `name` de `default` a `raw` deja aquella prueba en verde.
        //
        // Importa porque el lanzador no consulta con `QueryParser`: arma el
        // término a mano, en minúsculas, y lo mete en una consulta difusa. Que
        // los términos guardados estén en minúsculas no lo da el detalle de
        // indexado, lo da el tokenizador `default`, que es el que baja.
        //
        // Con `raw` el proveedor no se rompe del todo, que sería visible: sigue
        // encontrando los archivos que ya estaban en minúsculas y pierde los
        // que tienen una mayúscula. No parece roto, parece incompleto.
        //
        // Comprobado al revés antes de darlo por bueno: poniéndole `raw` a
        // `name` a mano, esta prueba falla y la de arriba sigue pasando.
        let (esquema, campos) = esquema();

        assert_eq!(
            tokenizador(&esquema, campos.nombre),
            Some("default"),
            "el nombre se parte en palabras y baja a minúsculas"
        );
        assert_eq!(
            tokenizador(&esquema, campos.ruta),
            Some("raw"),
            "la ruta se guarda entera y tal cual"
        );
        assert_eq!(
            tokenizador(&esquema, campos.nombre_minuscula),
            Some("raw"),
            "el nombre en minúsculas ya viene bajado de antes"
        );
    }
}
