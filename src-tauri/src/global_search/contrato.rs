//! El contrato del índice: dónde está y cómo se llama cada campo.
//!
//! Esto no es un detalle interno de la búsqueda global. Es lo **único** que
//! comparten dos programas que no comparten código: `vasak-prism`, que escanea
//! el disco y **escribe** el índice, y esta aplicación, que lo abre de sólo
//! lectura para su búsqueda. El lanzador tiene estas mismas constantes escritas
//! a mano en su lado.
//!
//! # El dueño cambió, y esta descripción con él
//!
//! Hasta la 0.21 era al revés: escribía el gestor y leía el lanzador. El cambio
//! —Vasak-OS/vasak-prism#33 y #75— es que el escaneo vive donde vive el proceso
//! que está prendido: el lanzador es un daemon de systemd y el gestor es una
//! ventana que se abre y se cierra.
//!
//! **La ruta no cambió y el índice no se rehízo.** Ya estaba en la caché
//! compartida, que no cuelga del nombre de ninguna de las dos aplicaciones, así
//! que cambiar de dueño fue sólo eso: el que escribe.
//!
//! # Por qué importa tanto para algo tan chico
//!
//! Porque romperlo no falla. Si acá se renombra un campo o se mueve el
//! directorio, los dos siguen compilando, siguen arrancando y simplemente dejan
//! de encontrar archivos: una lista vacía, que es indistinguible de «no hay nada
//! que coincida». No hay error, no hay registro, no hay nada que mirar.
//!
//! Por eso los nombres están en constantes y no sueltos en la llamada, y por
//! eso hay una prueba que los fija: para que cambiarlos sea un acto deliberado
//! que rompe algo visible acá, y no un renombre que alguien hace de paso.
//!
//! # Y tantivy también es parte del contrato
//!
//! Los dos programas tienen que usar la **misma versión de tantivy**: el formato
//! en disco cambia entre versiones, así que subirla de un lado solo deja al otro
//! sin poder abrir el índice. Hoy los dos están en 0.22 y la última publicada es
//! la 0.26: subir es una tanda coordinada entre los dos repositorios, no una
//! actualización de rutina.

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

/// El directorio compartido de VasakOS dentro de la caché del usuario.
///
/// Compartido a propósito: no cuelga del nombre de ninguna de las dos
/// aplicaciones porque no es de ninguna de las dos. La convención ya existía en
/// el sistema —`~/.cache/vasak/wallpapers`— y esto la sigue: `vasak-prism/` es
/// lo que es de una sola app, `vasak/` es lo que comparten.
pub const COMPARTIDO: &str = "vasak";
/// El subdirectorio donde vive todo lo de la búsqueda global.
pub const DIRECTORIO: &str = "global-search";
/// El índice propiamente dicho, adentro del directorio de la versión.
pub const INDICE: &str = "index";
/// Lo que se sabe del último escaneo. **Fuera** del directorio de la versión.
pub const ESTADO: &str = "status.json";

/// Cómo terminó —o si terminó— el último escaneo.
///
/// Van como cadena y no como un enum cerrado, y es deliberado: este archivo lo
/// escribe `vasak-prism` y lo lee esta aplicación, y los dos se actualizan por
/// separado. Si el lector deserializara contra un enum cerrado, agregar un
/// quinto estado acá le rompería el archivo **entero** —perdería también la
/// versión y la fecha—, o sea que agregar un estado le rompería más que no
/// tener el campo. Con una cadena, un valor que no conoce es un valor que no
/// conoce y el resto lo sigue leyendo.
///
/// Los nombres están elegidos por lo que el lector decide con cada uno, no por
/// lo que le pasó al escaneo:
///
/// - `EN_CURSO`: hay uno corriendo. El índice está a medio construir y va a
///   cambiar. Es el único no terminal, y el único que vence.
/// - `COMPLETO`: terminó y recorrió todo. Acá —y sólo acá— la ausencia es
///   ausencia: cero resultados significa que no hay nada que coincida.
/// - `CANCELADO`: alguien lo paró. Lo indexado sirve, pero falta.
/// - `FALLADO`: se cortó por un error. Igual que el anterior para quien lee.
///
/// # Falta el campo contra valor desconocido
///
/// No son lo mismo, y la regla es asimétrica a propósito:
///
/// - **Falta** → lo escribió un lanzador viejo, que no tenía cómo avisar. Se
///   trata como `COMPLETO`, que es como se venía tratando. Si no, cada
///   instalación sin actualizar se llenaría de avisos por algo que siempre fue
///   así.
/// - **No se conoce** → lo escribió un lanzador **más nuevo**, que sabe algo
///   que el lector no. Ahí se va al lado conservador: no se confía en que la
///   ausencia sea ausencia, y se dice.
///
/// Leído de golpe es contraintuitivo —la ausencia manda confiar y lo
/// desconocido manda desconfiar— así que va el motivo y no sólo la regla,
/// porque sin él alguien la «arregla».
/// # La versión gana sobre el estado
///
/// `status.json` vive **fuera** del directorio de la versión, así que describe
/// a la versión actual del lanzador y no necesariamente al índice que el lector
/// puede abrir. El día que esto pase a `v2`, un lector que sólo sabe leer `v1`
/// ve dos señales ciertas y contradictorias: no encuentra `v1/index`, y el
/// archivo le dice `schema_version: 2` con `scan_state: complete`.
///
/// La regla es que **si la versión del archivo no es la del índice que el
/// lector sabe abrir, el estado no se mira**, diga lo que diga. Es «el índice
/// es de otra versión», que es un caso propio y no «todo bien». Sin esto, la
/// situación que este archivo vino a explicar se leería como la sana, que es
/// exactamente al revés de para lo que está.
//
// Estas cuatro no las usa el código de Rust: quien decide qué decir con cada
// valor es la ventana, y del lado de TypeScript hay otra copia. Están acá
// porque son **vocabulario del contrato** y porque la prueba de más abajo las
// fija: sin ellas, renombrar un estado en `vasak-prism` no rompería nada de
// este lado y la ventana pasaría a tratar el valor nuevo como desconocido.
#[allow(dead_code)]
pub const ESTADO_EN_CURSO: &str = "in_progress";
/// Terminó y recorrió todo. Ver [`ESTADO_EN_CURSO`].
#[allow(dead_code)]
pub const ESTADO_COMPLETO: &str = "complete";
/// Alguien lo paró antes de terminar. Ver [`ESTADO_EN_CURSO`].
#[allow(dead_code)]
pub const ESTADO_CANCELADO: &str = "cancelled";
/// Se cortó por un error. Ver [`ESTADO_EN_CURSO`].
#[allow(dead_code)]
pub const ESTADO_FALLADO: &str = "failed";

/// Si un `EN_CURSO` todavía vale, o quedó de un escaneo que murió de golpe.
///
/// El acuerdo con `vasak-prism` es esta frase y ninguna constante: **si la
/// fecha no está entre ahora y ahora más el vencimiento declarado, esto no está
/// vivo**. El vencimiento lo declara el que escribe, porque el que sabe cuánto
/// puede tardar razonablemente un escaneo es el que escanea; si los lectores
/// eligieran cada uno su número, dirían cosas distintas sobre el mismo archivo
/// —la ventana «indexando» y el lanzador «incompleto»— y eso no falla, sólo se
/// contradice, que es peor.
///
/// Una fecha en el **futuro** cuenta como vencida. Un reloj corregido hacia
/// atrás, o una máquina que arrancó con la hora mal, dejarían un `EN_CURSO` que
/// no vence nunca y un «indexando» eterno que nadie puede destrabar. Es el
/// mismo criterio que `tauri-plugin-vicons` aplica a su caché: tratarlo como
/// vencido cuesta, como mucho, un «incompleto» de más; no tratarlo no tiene
/// arreglo desde adentro.
pub fn en_curso_sigue_vivo(escrito_en: u64, vence_en_ms: u64, ahora: u64) -> bool {
    escrito_en <= ahora && ahora < escrito_en.saturating_add(vence_en_ms)
}

/// La versión del esquema, que va en la ruta.
///
/// Subirla cambia el directorio, así que el índice viejo deja de usarse solo y
/// no hay que acordarse de borrar nada: un esquema nuevo nunca se lee con el
/// código viejo, que es la forma de fallar que no se nota.
pub const VERSION: u32 = 1;

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

/// El directorio compartido en la caché del usuario.
///
/// En caché y no en datos porque el índice es contenido derivado del disco: se
/// rehace entero escaneando, no hay nada que no se pueda recuperar, y no tiene
/// por qué sobrevivir a un borrado ni entrar en una copia de respaldo. Es el
/// mismo criterio con el que `vasak-prism` guarda su catálogo de aplicaciones
/// en caché y la frecuencia de uso en datos.
pub fn base_de_cache() -> Option<PathBuf> {
    base_de_cache_bajo(dirs::cache_dir())
}

/// Lo mismo, recibiendo la base en vez de leerla del entorno.
///
/// Aparte por dos motivos. El entorno es global al proceso y las pruebas corren
/// en paralelo: una que escriba una variable decide al azar el resultado de
/// otra, y eso ya pasó acá —la prueba de esta función cambiaba `HOME` y se
/// llevaba puestas al azar las de `open_with`—. Y porque así la decisión propia
/// se puede comprobar sin depender de en qué máquina corre.
///
/// **La base sale de `dirs` y no se calcula acá.** La regla de que una ruta XDG
/// relativa se ignora estaba escrita a mano en dos repositorios de este taller
/// y una tercera vez en `dirs`, que ya era dependencia directa y la resuelve
/// igual: una cadena vacía tampoco es absoluta, así que los dos casos salen de
/// la misma comprobación en vez de tratarse por separado —que es cómo se cubre
/// uno y se deja el otro afuera—.
///
/// Lo que `dirs` **no** hace es mirar `HOME`, del que sólo comprueba que no
/// esté vacío. Si `HOME` es relativo devuelve una base relativa, y el índice
/// terminaría colgando del directorio de trabajo de quien haya lanzado el
/// programa, que en un servicio de systemd puede ser cualquiera. El filtro de
/// acá cierra esa mitad.
pub fn base_de_cache_bajo(base: Option<PathBuf>) -> Option<PathBuf> {
    let base = base.filter(|base| base.is_absolute())?;
    Some(base.join(COMPARTIDO))
}

/// Dónde vive el índice, a partir del directorio compartido.
pub fn directorio_del_indice(base: &Path) -> PathBuf {
    base.join(DIRECTORIO)
        .join(format!("v{VERSION}"))
        .join(INDICE)
}

/// Dónde vive lo que se sabe del último escaneo.
///
/// Queda **afuera** del directorio de la versión, y es deliberado. Si cayera
/// adentro, al subir a `v2` el lector de `vasak-prism` no encontraría ni el
/// índice ni el archivo que le explicaría por qué: «existe y es de otra
/// versión» le llegaría como «no existe», que es el caso que este archivo tiene
/// que poder distinguir. Sería poner el cartel del otro lado de la puerta
/// cerrada.
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
        // La otra mitad. El lanzador la arma con esta misma forma, y con el
        // mismo directorio compartido, que no es de ninguna de las dos apps.
        let base = Path::new("/casa/.cache/vasak");

        assert_eq!(
            directorio_del_indice(base),
            Path::new("/casa/.cache/vasak/global-search/v1/index")
        );
    }

    #[test]
    fn el_estado_queda_fuera_del_directorio_de_la_version() {
        // Deliberado: es lo único que le permite al lanzador distinguir «el
        // índice todavía no existe» de «existe y es de otra versión». Si el
        // archivo viviera adentro de `v1/`, al pasar a `v2` desaparecería junto
        // con el índice y los dos casos le llegarían iguales.
        let base = Path::new("/casa/.cache/vasak");

        assert_eq!(
            archivo_de_estado(base),
            Path::new("/casa/.cache/vasak/global-search/status.json")
        );

        // Y la forma, no sólo la cadena: el estado no puede quedar por debajo
        // del directorio que se renueva al subir la versión.
        let estado = archivo_de_estado(base);
        let indice = directorio_del_indice(base);
        let directorio_de_la_version = indice.parent().unwrap();

        assert!(
            !estado.starts_with(directorio_de_la_version),
            "subir la versión se llevaría el estado puesto"
        );
        assert_ne!(
            estado.parent().unwrap(),
            directorio_de_la_version,
            "el estado vive un nivel más arriba, en el directorio estable"
        );
    }

    #[test]
    fn la_base_cuelga_del_directorio_compartido() {
        assert_eq!(
            base_de_cache_bajo(Some(PathBuf::from("/casa/.cache"))),
            Some(PathBuf::from("/casa/.cache/vasak"))
        );
    }

    #[test]
    fn una_base_que_no_es_absoluta_no_sirve() {
        // La mitad que `dirs` no cubre: de `HOME` sólo comprueba que no esté
        // vacío, así que un `HOME` relativo le sale como base relativa. Y una
        // ruta que no arranca en la raíz se resuelve contra el directorio de
        // trabajo de quien haya lanzado el programa, que en un servicio de
        // systemd puede ser cualquiera: el índice quedaría escrito en un lugar
        // impredecible y distinto según desde dónde se lanzó.
        //
        // La cadena vacía entra en la misma comprobación y no en una aparte,
        // que es la forma de no cubrir una de las dos.
        for base in ["", "cache", "./cache", "../cache"] {
            assert_eq!(
                base_de_cache_bajo(Some(PathBuf::from(base))),
                None,
                "«{base}» no es una ruta absoluta"
            );
        }
    }

    #[test]
    fn sin_base_no_se_inventa_una() {
        // `dirs` devuelve nada cuando no hay de dónde sacarla. Eso se dice, no
        // se rellena con un valor por omisión.
        assert_eq!(base_de_cache_bajo(None), None);
    }

    #[test]
    fn los_estados_del_escaneo_tampoco_se_tocan() {
        // Son la otra mitad del contrato: `vasak-prism` los compara contra
        // cadenas escritas a mano de su lado. Renombrar uno acá lo manda a la
        // rama de «valor que no conozco», que es la conservadora — o sea que no
        // se rompe, empieza a desconfiar de todo. Silencioso otra vez.
        assert_eq!(ESTADO_EN_CURSO, "in_progress");
        assert_eq!(ESTADO_COMPLETO, "complete");
        assert_eq!(ESTADO_CANCELADO, "cancelled");
        assert_eq!(ESTADO_FALLADO, "failed");
    }

    #[test]
    fn un_en_curso_vence_por_su_propio_vencimiento() {
        let escrito = 1_000_000u64;
        let vence_en = 60_000u64;

        assert!(
            en_curso_sigue_vivo(escrito, vence_en, escrito),
            "recién escrito está vivo"
        );
        assert!(
            en_curso_sigue_vivo(escrito, vence_en, escrito + vence_en - 1),
            "un milisegundo antes del vencimiento sigue vivo"
        );
        assert!(
            !en_curso_sigue_vivo(escrito, vence_en, escrito + vence_en),
            "justo en el vencimiento ya no"
        );
        assert!(
            !en_curso_sigue_vivo(escrito, vence_en, escrito + vence_en * 10),
            "mucho después tampoco"
        );
    }

    #[test]
    fn una_fecha_del_futuro_cuenta_como_vencida() {
        // El caso que la frase sola no cubre: un reloj corregido hacia atrás
        // deja un «en curso» que nunca vence, porque `escrito + vencimiento`
        // siempre es mayor que ahora. Sin esto el estado queda en «indexando»
        // para siempre y no hay forma de destrabarlo salvo borrar el archivo a
        // mano.
        let ahora = 1_000_000u64;
        let escrito_mas_tarde = ahora + 1;

        assert!(
            !en_curso_sigue_vivo(escrito_mas_tarde, 60_000, ahora),
            "algo escrito en el futuro no puede estar vivo"
        );
    }

    #[test]
    fn un_vencimiento_enorme_no_da_la_vuelta() {
        // `escrito + vencimiento` se puede pasar de `u64` y envolver a un
        // número chico, y entonces un «en curso» recién escrito se leería como
        // vencido. Con saturación se queda arriba de todo, que es lo correcto:
        // un vencimiento absurdo significa «esto no vence», no «ya venció».
        assert!(en_curso_sigue_vivo(1_000, u64::MAX, 2_000));
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
