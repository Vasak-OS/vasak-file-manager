//! Qué clase de archivo es cada cosa, según el escritorio.
//!
//! Antes esto era una tabla de cuarenta extensiones escrita a mano. Todo lo que
//! no estuviera en ella salía como `application/octet-stream`, y la ventana lo
//! dibujaba con el icono de hoja en blanco: los binarios de `/usr/bin`, que no
//! tienen extensión, eran el caso más visible —tres mil archivos, todos iguales
//! y todos mal.
//!
//! Ahora la pregunta la contesta la misma base de datos que usan `gio`,
//! `xdg-mime` y el resto del escritorio (`shared-mime-info`), así que un tipo
//! nuevo lo trae el sistema y no hay que agregarlo acá.
//!
//! ## Por qué está partido en dos
//!
//! Averiguarlo tiene dos precios muy distintos, medidos sobre `/usr/bin` —3585
//! archivos, el peor caso posible porque ninguno tiene extensión—:
//!
//! | | 3585 archivos |
//! |---|---|
//! | por el nombre, sin tocar el disco | 29 ms |
//! | leer los primeros bytes | 3 ms |
//! | **reconocer la cabecera con GIO** | **550 ms** |
//!
//! Lo caro no es el disco: es `g_content_type_guess` con datos, que recorre las
//! reglas de la base **con un candado global**. Repartirlo entre los núcleos no
//! cambia nada —medido: 577 ms en paralelo contra 549 en fila— así que no hay
//! forma de esconderlo.
//!
//! Y 550 ms es justo lo que no puede costar abrir una carpeta: el listado entero
//! tardaba **5 ms** antes de esto.
//!
//! De ahí las dos funciones:
//!
//! - [`por_el_nombre`] es la que usa el listado. Gratis, y acierta en cualquier
//!   carpeta donde los archivos tengan extensión, que son casi todas.
//! - [`mirando_adentro`] es la que contesta bien lo que no tiene extensión, y la
//!   pide la ventana **sólo para las entradas que llega a dibujar**. Con las
//!   vistas virtualizadas eso son unas sesenta por pantalla: 9 ms en vez de 550,
//!   y fuera del camino de abrir la carpeta.

use gtk::gio;
use gtk::gio::prelude::*;
use gtk::glib;
use gtk::glib::translate::from_glib_full;
use std::ffi::CString;
use std::fs::File;
use std::io::Read;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

/// Cuántos bytes alcanzan para reconocer una cabecera.
///
/// `shared-mime-info` no mira más allá de unos pocos cientos, y leer una página
/// entera cuesta lo mismo que leer menos: el kernel trae la página igual.
const CABECERA: usize = 4096;

/// Lo que contesta GIO cuando no reconoció nada.
const DESCONOCIDO: &str = "application/octet-stream";

/// El tipo de contenido de un archivo, por su nombre y nada más.
///
/// No abre el archivo, así que es lo que puede permitirse el listado de una
/// carpeta. Para lo que no tiene extensión contesta `application/octet-stream`,
/// que es GIO diciendo «con el nombre no me alcanza»: ahí entra
/// [`mirando_adentro`].
///
/// `None` para lo que no es un archivo: una carpeta no necesita que le adivinen
/// nada, la ventana ya sabe dibujarla.
pub fn por_el_nombre(path: &Path, es_archivo: bool) -> Option<String> {
    if !es_archivo {
        return None;
    }

    adivinar(path, None)
}

/// El tipo de contenido de un archivo, leyéndole la cabecera.
///
/// Es lo mismo que contesta `gio info`, y se comprobó que lo sea: sobre 989
/// archivos de `/usr/bin`, `/etc`, `/usr/lib`, `/usr/share/applications` y el
/// directorio del usuario, coincide con `g_file_query_info` en **987**. Los dos
/// que no son `/etc/mtab` —un enlace a `/proc/self/mounts`, que mide cero— y un
/// archivo de bloqueo vacío: el sistema mira el tamaño y contesta
/// `application/x-zerosize` donde acá se mira el contenido.
///
/// Que coincida importa más que tener razón por cuenta propia: el icono que
/// dibuja esta ventana tiene que ser el mismo que dibuja el resto del
/// escritorio para el mismo archivo.
#[tauri::command]
pub fn mirando_adentro(rutas: Vec<String>) -> Vec<Option<String>> {
    rutas
        .iter()
        .map(|ruta| tipo_leyendo(Path::new(ruta)))
        .collect()
}

fn tipo_leyendo(path: &Path) -> Option<String> {
    let por_el_nombre = adivinar(path, None)?;

    if por_el_nombre != DESCONOCIDO {
        return Some(por_el_nombre);
    }

    // El nombre no dijo nada: o no tiene extensión, o tiene una que la base no
    // conoce. Recién acá se lee.
    let Some(bytes) = cabecera_de(path) else {
        // Sin permiso de lectura, o el archivo se fue entre el listado y esto.
        return Some(por_el_nombre);
    };

    // El nombre se sigue pasando: hay reglas que combinan las dos cosas.
    adivinar(path, Some(&bytes)).or(Some(por_el_nombre))
}

/// `g_content_type_guess`, con la diferencia de poder no pasarle datos.
///
/// La firma de `gio::content_type_guess` pide un `&[u8]` y no un `Option`, y ahí
/// está el problema: un slice vacío de Rust **no** es un puntero nulo, es un
/// puntero válido a cero bytes. GIO distingue las dos cosas —`NULL` significa
/// «no tengo el contenido, mirá el nombre» y un puntero con largo cero significa
/// «lo tengo y el archivo está vacío»— y con lo segundo contesta
/// `application/x-zerosize` para **todo**, incluido un `.png` que existe y pesa.
///
/// Costó un test rojo darse cuenta, así que queda escrito.
fn adivinar(path: &Path, datos: Option<&[u8]>) -> Option<String> {
    // Un nombre con un cero en el medio no puede llegar a C. No existe en un
    // sistema de archivos de Linux, pero la conversión lo contempla igual.
    let nombre = CString::new(path.as_os_str().as_bytes()).ok()?;

    let (puntero, largo) = match datos {
        Some(bytes) => (bytes.as_ptr(), bytes.len()),
        None => (std::ptr::null(), 0),
    };

    // SAFETY: `nombre` vive hasta el final de la llamada y termina en cero;
    // `puntero`/`largo` describen el mismo slice o son el par nulo que GIO
    // espera para «sin datos». `g_content_type_guess` devuelve una cadena recién
    // reservada, y `from_glib_full` es justamente quien toma esa propiedad y la
    // libera.
    let tipo: glib::GString = unsafe {
        let mut incierto = glib::ffi::GFALSE;
        from_glib_full(gio::ffi::g_content_type_guess(
            nombre.as_ptr(),
            puntero,
            largo,
            &mut incierto,
        ))
    };

    Some(tipo.to_string())
}

/// El último recurso, cuando el tema no tenga ninguno de los otros.
///
/// Está en cualquier tema de iconos: es el que la especificación de freedesktop
/// obliga a tener para «un archivo cualquiera».
const GENERICO: &str = "application-x-generic";

/// Con qué iconos se puede dibujar ese tipo, del más preciso al más genérico.
///
/// La cadena la arma GIO y no esta función, que es lo que hace que salga bien:
/// sabe que `text/x-python3` es un `text/x-python`, que un `.deb` es un paquete
/// y que un PDF es un documento de oficina, y por eso `text-x-python3` cae en
/// `text-x-generic` y no en la hoja en blanco. Reconstruir esos parentescos acá
/// sería copiar media base de datos del sistema.
///
/// Se pregunta por tipo y no por archivo: una carpeta con 3585 entradas tiene
/// una docena de tipos distintos, y la ventana guarda lo que ya preguntó.
#[tauri::command]
pub fn iconos_de_tipo(tipo: String) -> Vec<String> {
    nombres_de_icono(&tipo)
}

fn nombres_de_icono(tipo: &str) -> Vec<String> {
    let icono = gio::functions::content_type_get_icon(tipo);

    let mut nombres: Vec<String> = icono
        .downcast_ref::<gio::ThemedIcon>()
        .map(|tematico| {
            tematico
                .names()
                .iter()
                // GIO intercala las variantes de línea —`…-symbolic`— con las
                // normales. Acá se dibujan iconos a color y a tamaño grande, así
                // que ésas sobran: dejarlas sólo haría que una de línea le ganara
                // a la normal del tipo padre.
                .filter(|nombre| !nombre.ends_with("-symbolic"))
                .map(|nombre| nombre.to_string())
                .collect()
        })
        .unwrap_or_default();

    // Hay tipos cuya cadena no termina en un genérico: `application/x-executable`
    // contesta un solo nombre. Si el tema no lo tuviera, sin esto quedaría el
    // cuadrito de imagen rota.
    if !nombres.iter().any(|nombre| nombre == GENERICO) {
        nombres.push(GENERICO.to_string());
    }

    nombres
}

/// Los primeros bytes del archivo, o nada si no se puede leer.
fn cabecera_de(path: &Path) -> Option<Vec<u8>> {
    // Sólo archivos regulares, y no por prolijidad: abrir una **FIFO** sin nadie
    // del otro lado deja a `File::open` esperando para siempre. Una tubería con
    // nombre y sin extensión llega hasta acá como cualquier otra entrada, y con
    // ella se colgaría el comando entero —no esa fila: las sesenta del lote, que
    // viajan juntas—. Lo mismo vale para un dispositivo de caracteres.
    //
    // Lo que sale del nombre se conserva igual, que es lo que se dibuja.
    if !path.is_file() {
        return None;
    }

    let mut archivo = File::open(path).ok()?;
    let mut bytes = vec![0_u8; CABECERA];
    let leidos = archivo.read(&mut bytes).ok()?;
    bytes.truncate(leidos);
    Some(bytes)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use std::io::Write;

    /// Una carpeta para trabajar, propia de cada prueba.
    fn carpeta_de(nombre: &str) -> std::path::PathBuf {
        let ruta = std::env::temp_dir().join(format!("vasak-tipo-{nombre}"));
        let _ = std::fs::remove_dir_all(&ruta);
        std::fs::create_dir_all(&ruta).expect("se puede escribir en temp");
        ruta
    }

    /// Una carpeta no pregunta nada.
    #[test]
    fn una_carpeta_no_tiene_tipo() {
        assert_eq!(por_el_nombre(Path::new("/usr"), false), None);
    }

    /// El caso que originó todo esto: un binario sin extensión.
    ///
    /// Va contra `/usr/bin/env`, que existe en cualquier Linux. Si el sistema
    /// donde corren los tests no lo tuviera, se saltea en vez de fallar: lo que
    /// se comprueba es la resolución, no el sistema de archivos ajeno.
    #[test]
    fn un_binario_sin_extension_no_es_un_archivo_cualquiera() {
        let binario = Path::new("/usr/bin/env");

        if !binario.exists() {
            return;
        }

        // Por el nombre no hay nada que sacar, y eso es lo correcto: es lo que
        // le dice a la ventana que tiene que preguntar de nuevo.
        assert_eq!(
            por_el_nombre(binario, true).as_deref(),
            Some(DESCONOCIDO),
            "sin extensión, el nombre no puede saber nada"
        );

        let tipo = tipo_leyendo(binario).expect("un archivo siempre da algo");

        assert!(
            tipo.contains("executable") || tipo.contains("sharedlib") || tipo.contains("script"),
            "se esperaba algo ejecutable y salió {tipo}"
        );
    }

    /// Lo que tiene extensión conocida no paga la lectura, y da lo obvio.
    ///
    /// El archivo se deja **vacío** a propósito: si el nombre no alcanzara y
    /// hubiera que mirar el contenido, esto saldría `application/x-zerosize`.
    /// Que salga `image/png` es la prueba de que se resolvió sin leer.
    #[test]
    fn la_extension_conocida_alcanza_sola() {
        let archivo = carpeta_de("extension").join("cualquiera.png");
        std::fs::write(&archivo, b"").expect("se puede escribir");

        assert_eq!(
            por_el_nombre(&archivo, true).as_deref(),
            Some("image/png"),
            "alcanzaba el nombre y no hacía falta abrirlo"
        );
    }

    /// Sin extensión, manda la cabecera.
    #[test]
    fn sin_extension_manda_la_cabecera() {
        let archivo = carpeta_de("cabecera").join("sin-extension-ninguna");

        let mut escritura = File::create(&archivo).expect("se puede escribir");
        escritura
            .write_all(b"#!/bin/sh\necho hola\n")
            .expect("se puede escribir");
        drop(escritura);

        let tipo = tipo_leyendo(&archivo).expect("un archivo siempre da algo");

        assert!(
            tipo.contains("shellscript"),
            "con un shebang de sh adelante se esperaba un script y salió {tipo}"
        );
    }

    /// Sin extensión y sin nada adentro que reconocer, queda el genérico.
    ///
    /// Importa que siga saliendo un tipo y no `None`: la ventana elige el icono
    /// a partir de esta cadena, y sin ella no tendría de dónde.
    #[test]
    fn lo_que_no_se_reconoce_sigue_teniendo_tipo() {
        let archivo = carpeta_de("generico").join("datos-crudos");
        std::fs::write(&archivo, [0x00_u8, 0x01, 0x02, 0x03, 0xff]).expect("se puede escribir");

        assert!(
            tipo_leyendo(&archivo).is_some(),
            "un archivo siempre tiene que dar algo con qué elegir icono"
        );
    }

    /// La cadena de iconos sale ordenada y sin las variantes de línea.
    #[test]
    fn los_nombres_de_icono_van_de_lo_preciso_a_lo_generico() {
        let nombres = nombres_de_icono("text/x-python3");

        assert_eq!(
            nombres.first().map(String::as_str),
            Some("text-x-python3"),
            "primero el del tipo exacto"
        );
        assert!(
            nombres.iter().any(|nombre| nombre == "text-x-generic"),
            "y después el genérico del padre, que es lo que GIO sabe y acá no"
        );
        assert!(
            !nombres.iter().any(|nombre| nombre.ends_with("-symbolic")),
            "las variantes de línea no sirven acá: {nombres:?}"
        );
    }

    /// Ninguna cadena termina sin una red debajo.
    ///
    /// `application/x-executable` es el ejemplo: GIO contesta un solo nombre. Si
    /// un tema no lo tuviera, sin el genérico al final quedaría el cuadrito.
    #[test]
    fn toda_cadena_termina_en_el_generico() {
        for tipo in [
            "application/x-executable",
            "text/x-shellscript",
            "image/png",
            "esto/no-existe",
        ] {
            let nombres = nombres_de_icono(tipo);

            assert_eq!(
                nombres.last().map(String::as_str),
                Some(GENERICO),
                "{tipo} se quedó sin red: {nombres:?}"
            );
        }
    }

    /// El comando nunca contesta una cadena vacía.
    #[test]
    fn el_comando_siempre_da_con_que_dibujar() {
        for tipo in ["application/x-executable", "image/png", "esto/no-existe"] {
            assert!(
                !iconos_de_tipo(tipo.to_string()).is_empty(),
                "{tipo} se quedó sin iconos"
            );
        }
    }

    /// Un archivo que no existe no hace fallar nada.
    #[test]
    fn lo_que_no_existe_contesta_igual() {
        assert_eq!(
            tipo_leyendo(Path::new("/no/existe/esto.png")).as_deref(),
            Some("image/png"),
            "no se puede leer, así que queda lo que dijo el nombre"
        );
    }

    /// Una tubería con nombre no cuelga el lote entero.
    ///
    /// `File::open` sobre una FIFO sin escritor espera para siempre. Como las
    /// entradas de una pantalla viajan juntas, una sola tubería sin extensión en
    /// la carpeta dejaba a las sesenta sin icono y el comando sin volver.
    ///
    /// Se mide contra un reloj en vez de llamar y ya: si la protección se cae,
    /// esto tiene que fallar, no colgarse.
    #[test]
    fn una_tuberia_no_deja_esperando() {
        let carpeta = carpeta_de("tuberia");
        let tuberia = carpeta.join("sin-nadie-del-otro-lado");

        let nombre = CString::new(tuberia.as_os_str().as_bytes()).expect("ruta sin ceros");
        // SAFETY: `nombre` termina en cero y vive hasta el final de la llamada.
        let creada = unsafe { libc::mkfifo(nombre.as_ptr(), 0o644) };

        if creada != 0 {
            // Un sistema de archivos que no admite FIFOs. No hay nada que probar.
            return;
        }

        let (mandar, recibir) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = mandar.send(tipo_leyendo(&tuberia));
        });

        let contestada = recibir.recv_timeout(std::time::Duration::from_secs(5));

        assert!(
            contestada.is_ok(),
            "se quedó esperando a que alguien escribiera en la tubería"
        );
        assert!(
            contestada.unwrap().is_some(),
            "sin poder mirar adentro igual tiene que quedar lo que dijo el nombre"
        );
    }

    /// El comando contesta uno por ruta y en el mismo orden.
    #[test]
    fn el_comando_contesta_en_orden() {
        let rutas = vec![
            "/no/existe/esto.png".to_string(),
            "/no/existe/aquello.mp3".to_string(),
        ];

        assert_eq!(
            mirando_adentro(rutas),
            vec![
                Some("image/png".to_string()),
                Some("audio/mpeg".to_string()),
            ]
        );
    }
}
