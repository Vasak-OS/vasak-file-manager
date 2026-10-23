//! Miniaturas de video, hechas por ffmpeg y guardadas en disco. Y las de imagen,
//! hechas en Rust: ver [`miniatura_de_imagen`].
//!
//! Antes las generaba el frontend: creaba un `<video>`, lo buscaba al 10 % y
//! dibujaba el cuadro en un `<canvas>` **del tamaño del video**
//! (`canvas.width = video.videoWidth`), para después pedirle un JPEG. Un archivo
//! 4K decodificaba 8,3 millones de píxeles dentro del proceso de la interfaz
//! para producir una imagen de 200 píxeles de lado, y como no se guardaba en
//! ningún lado, volvía a hacerlo cada vez que se abría la carpeta.
//!
//! ffmpeg extrae y escala el cuadro de una sola pasada, fuera del proceso de la
//! interfaz, y el resultado queda en la caché de miniaturas del usuario: la
//! segunda visita a una carpeta no cuesta nada.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

/// Lado máximo de la miniatura.
///
/// La vista las dibuja bastante más chicas; de más grande sólo se paga disco y
/// tiempo de escalado para píxeles que nadie ve.
const LADO: u32 = 320;

/// Plazo para ffmpeg y ffprobe.
///
/// `Command::output()` espera a que el hijo termine, sin límite: un montaje de
/// red colgado o un archivo patológico se queda con un hilo del pool para
/// siempre, y la promesa del frontend nunca se resuelve. Con seis así, la cola
/// de miniaturas no arranca ninguna más.
const PLAZO: Duration = Duration::from_secs(20);

/// Corre un comando con plazo, matándolo si se pasa.
fn con_plazo(mut orden: Command) -> Result<std::process::Output, String> {
    let mut hijo = orden
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "ffmpeg no está instalado: no se pueden generar miniaturas de video".to_string()
            } else {
                format!("No se pudo ejecutar: {error}")
            }
        })?;

    let desde = Instant::now();
    loop {
        match hijo.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if desde.elapsed() > PLAZO {
                    let _ = hijo.kill();
                    // Sin `wait()` acá. En Linux `kill()` manda SIGKILL, pero un
                    // proceso en E/S no interrumpible no muere hasta que el
                    // kernel termine la operación, y `wait()` bloquearía más allá
                    // del plazo: la promesa del frontend nunca se resolvería,
                    // que es justo lo que este plazo viene a evitar. Se lo
                    // recoge en otro hilo para no dejar un zombi.
                    std::thread::spawn(move || {
                        let _ = hijo.wait();
                    });
                    return Err("tardó demasiado y se canceló".to_string());
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return Err(format!("no se pudo esperar al proceso: {error}")),
        }
    }

    hijo.wait_with_output()
        .map_err(|error| format!("no se pudo leer la salida: {error}"))
}

/// Dónde se buscan y guardan.
///
/// Caché **propia**, no la de freedesktop. Esa especificación usa
/// `thumbnails/normal|large/<md5 del URI>.png`, y acá se guarda
/// `thumbnails/vasak-video/<fnv1a>.jpg`: ninguna otra aplicación lo lee ni lo
/// escribe. Vive bajo `thumbnails/` para que las herramientas que limpian
/// cachés la encuentren, y no para compartirla.
fn directorio_cache() -> Option<PathBuf> {
    let dir = directorio_cache_bajo(dirs::cache_dir())?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Dónde iría, sin crear nada y sin leer el entorno.
///
/// Aparte por las dos cosas. Sin leer el entorno porque es global al proceso y
/// las pruebas corren en paralelo: una que escriba una variable decide al azar
/// el resultado de otra. Y sin crear el directorio para que la prueba compruebe
/// la decisión en vez de dejar carpetas por el disco.
///
/// La base pasa por `dirs` en vez de leerse acá. Antes se aceptaba cualquier
/// valor de `XDG_CACHE_HOME`, incluida la cadena vacía y cualquier ruta
/// relativa, que el estándar manda ignorar — y como justo abajo se hace
/// `create_dir_all`, con una base relativa las miniaturas se escribían bajo el
/// directorio de trabajo del proceso, sin que nada fallara.
///
/// `dirs` implementa la regla como una sola y no como dos: una cadena vacía
/// tampoco es absoluta, así que los dos casos salen de la misma comprobación.
/// De `HOME` sólo mira que no esté vacía, así que el filtro de acá cierra esa
/// otra mitad.
fn directorio_cache_bajo(base: Option<PathBuf>) -> Option<PathBuf> {
    let base = base.filter(|base| base.is_absolute())?;
    Some(base.join("thumbnails").join("vasak-video"))
}

/// Nombre del archivo de caché para una ruta.
///
/// Lleva el tamaño y la fecha de modificación además de la ruta: un video
/// reemplazado por otro con el mismo nombre tiene que dar una miniatura nueva, y
/// comparar contenidos costaría más que generarla.
fn clave(ruta: &Path) -> Option<String> {
    let metadatos = std::fs::metadata(ruta).ok()?;
    let modificado = metadatos
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // Hash propio y no una dependencia: esto sólo tiene que distinguir
    // archivos, no resistir a nadie. FNV-1a sobre ruta, tamaño y fecha.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let entrada = format!("{}|{}|{}", ruta.display(), metadatos.len(), modificado);
    for byte in entrada.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    Some(format!("{hash:016x}.jpg"))
}

/// Devuelve la ruta de la miniatura de `video`, generándola si hace falta.
///
/// Devuelve la ruta y no los bytes: la vista la carga con el protocolo de
/// archivos, así que la imagen no cruza el IPC. Antes viajaba como data URL en
/// base64, o sea un tercio más de bytes por cada miniatura de cada carpeta.
pub fn miniatura(video: &Path) -> Result<PathBuf, String> {
    if !video.is_file() {
        return Err("El video no existe".to_string());
    }

    let cache = directorio_cache().ok_or("No se pudo crear la caché de miniaturas")?;
    let destino = cache.join(clave(video).ok_or("No se pudo leer el video")?);
    // Las de imagen son PNG: conservan la transparencia de un logo o un icono, que
    // en JPEG saldría sobre negro.
    let destino = if es_imagen(video) {
        destino.with_extension("png")
    } else {
        destino
    };

    if destino.is_file() {
        return Ok(destino);
    }

    if es_imagen(video) {
        return miniatura_de_imagen(video, &destino);
    }

    // `-ss` antes de `-i` busca por índice sin decodificar lo anterior, que es
    // la diferencia entre leer un cuadro y leer el archivo entero. Al 10 % del
    // video en lugar del principio, porque muchos empiezan en negro.
    let posicion = duracion(video).map(|d| d * 0.1).unwrap_or(1.0).max(0.0);

    // Se escribe a un temporal y se renombra al final.
    //
    // ffmpeg escribiendo directo al destino deja un JPEG a medias si el proceso
    // muere o si dos generaciones del mismo video corren a la vez, y la
    // comprobación de más arriba lo devolvería como caché válida: la vista
    // mostraría una imagen rota para siempre, porque la clave sólo cambia si
    // cambia el tamaño o la fecha del video. `rename` en el mismo directorio es
    // atómico.
    // Un contador propio y no el PID: `std::process::id()` es el mismo para
    // todas las generaciones de este proceso, así que dos miniaturas del mismo
    // video en paralelo escribían el mismo temporal — y `rename` sólo es atómico
    // si cada escritor tiene el suyo.
    static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let parcial = destino.with_extension(format!("parcial-{}-{nonce}.jpg", std::process::id()));

    let mut orden = Command::new("ffmpeg");
    orden
        .args(["-v", "error", "-nostdin"])
        .args(["-ss", &format!("{posicion:.3}")])
        .arg("-i")
        .arg(video)
        .args(["-frames:v", "1"])
        // `force_original_aspect_ratio=decrease` con `-1` en un lado deforma
        // menos que fijar los dos; `scale` sólo reduce.
        .args([
            "-vf",
            &format!("scale='min({LADO},iw)':-2:force_original_aspect_ratio=decrease"),
        ])
        .args(["-q:v", "4", "-y"])
        .arg(&parcial);

    let salida = con_plazo(orden).inspect_err(|_| {
        // El temporal se limpia igual: si quedara, el próximo intento lo
        // encontraría a medio escribir.
        let _ = std::fs::remove_file(&parcial);
    })?;

    if !salida.status.success() || !parcial.is_file() {
        // Un video roto o un formato que ffmpeg no abre no es un error de la
        // aplicación: la vista se queda con el icono genérico.
        let _ = std::fs::remove_file(&parcial);
        let detalle = String::from_utf8_lossy(&salida.stderr).trim().to_string();
        return Err(if detalle.is_empty() {
            "ffmpeg no pudo extraer un cuadro".to_string()
        } else {
            detalle
        });
    }

    std::fs::rename(&parcial, &destino).map_err(|error| {
        let _ = std::fs::remove_file(&parcial);
        format!("no se pudo guardar la miniatura: {error}")
    })?;

    Ok(destino)
}

/// Las extensiones que decodifica `image` con los formatos que se compilan.
///
/// SVG, ICO, TIFF y AVIF quedan afuera: el primero WebKit lo dibuja a la medida
/// que se le pide, así que no pesa; el resto no se compilan para no sumar
/// decodificadores a un binario por casos raros. La vista no los pide.
fn es_imagen(ruta: &Path) -> bool {
    ruta.extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|e| {
            ["jpg", "jpeg", "png", "gif", "bmp", "webp"]
                .iter()
                .any(|conocida| e.eq_ignore_ascii_case(conocida))
        })
}

/// Miniatura de una imagen, hecha acá y no por ffmpeg.
///
/// Es opcional que ffmpeg esté instalado (`optdepends`), y la miniatura de una
/// imagen no puede depender de él: sin miniatura la grilla cargaría la imagen
/// entera en el WebView, que es lo que esto viene a evitar. WebKit decodifica a
/// tamaño real aunque el `<img>` se dibuje a 120 px: seis fondos de pantalla
/// (14 MB en disco) eran ~480 MiB en el proceso web.
///
/// Se decodifica de a una por vez. Un fondo de 8K ocupa más de cien megas
/// descomprimido, y con las seis generaciones simultáneas de la vista el pico
/// pasaba de los seiscientos.
fn miniatura_de_imagen(origen: &Path, destino: &Path) -> Result<PathBuf, String> {
    // shortcut: una a la vez aunque sobren núcleos; si la primera visita a una
    // carpeta enorme se siente lenta, escalar mientras se decodifica.
    static UNA_A_LA_VEZ: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _turno = UNA_A_LA_VEZ
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);

    let abrir = |error: image::ImageError| format!("no se pudo abrir la imagen: {error}");
    let mut decodificador = image::ImageReader::open(origen)
        .map_err(|error| format!("no se pudo abrir la imagen: {error}"))?
        .with_guessed_format()
        .map_err(|error| format!("no se pudo abrir la imagen: {error}"))?
        .into_decoder()
        .map_err(abrir)?;
    // La marca EXIF de una foto de celular dice cómo girarla. Sin una marca
    // legible se la toma derecha, no se descarta la miniatura.
    let orientacion = image::ImageDecoder::orientation(&mut decodificador)
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut imagen = image::DynamicImage::from_decoder(decodificador).map_err(abrir)?;
    imagen.apply_orientation(orientacion);
    // `thumbnail` también agranda: un icono de 64 px saldría de 320.
    let chica = if imagen.width() <= LADO && imagen.height() <= LADO {
        imagen
    } else {
        imagen.thumbnail(LADO, LADO)
    };

    // Temporal y `rename`, por lo mismo que en el video: dos generaciones de la
    // misma imagen no pueden dejar un archivo a medias como caché válida.
    static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let parcial = destino.with_extension(format!("parcial-{}-{nonce}.png", std::process::id()));

    chica
        .save_with_format(&parcial, image::ImageFormat::Png)
        .map_err(|error| {
            let _ = std::fs::remove_file(&parcial);
            format!("no se pudo guardar la miniatura: {error}")
        })?;
    std::fs::rename(&parcial, destino).map_err(|error| {
        let _ = std::fs::remove_file(&parcial);
        format!("no se pudo guardar la miniatura: {error}")
    })?;
    Ok(destino.to_path_buf())
}

/// Duración en segundos, según ffprobe.
///
/// Opcional a propósito: si no se puede saber, se toma el segundo 1 en lugar de
/// fallar. Una miniatura del principio es peor que una del 10 %, pero es una
/// miniatura.
fn duracion(video: &Path) -> Option<f64> {
    let mut orden = Command::new("ffprobe");
    orden
        .args(["-v", "error", "-show_entries", "format=duration"])
        .args(["-of", "default=noprint_wrappers=1:nokey=1"])
        .arg(video);
    let salida = con_plazo(orden).ok()?;

    String::from_utf8_lossy(&salida.stdout).trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_clave_cambia_si_el_archivo_cambia() {
        let dir = std::env::temp_dir().join("vasak-thumb-test");
        std::fs::create_dir_all(&dir).unwrap();
        let archivo = dir.join("uno.mp4");

        std::fs::write(&archivo, b"aaaa").unwrap();
        let primera = clave(&archivo).unwrap();

        // Otro tamaño con el mismo nombre tiene que dar otra miniatura, o se
        // vería la del video anterior.
        std::fs::write(&archivo, b"aaaaaaaaaaaa").unwrap();
        let segunda = clave(&archivo).unwrap();

        assert_ne!(primera, segunda);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_clave_es_estable_para_el_mismo_archivo() {
        let dir = std::env::temp_dir().join("vasak-thumb-test-2");
        std::fs::create_dir_all(&dir).unwrap();
        let archivo = dir.join("dos.mp4");
        std::fs::write(&archivo, b"bbbb").unwrap();

        // Si no fuera estable, la caché no serviría de nada.
        assert_eq!(clave(&archivo), clave(&archivo));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_clave_termina_en_jpg() {
        let dir = std::env::temp_dir().join("vasak-thumb-test-3");
        std::fs::create_dir_all(&dir).unwrap();
        let archivo = dir.join("tres.mp4");
        std::fs::write(&archivo, b"c").unwrap();

        assert!(clave(&archivo).unwrap().ends_with(".jpg"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_archivo_que_no_existe_no_genera_nada() {
        let error = miniatura(Path::new("/no/existe/video.mp4")).unwrap_err();
        assert!(error.contains("no existe"), "{error}");
    }

    /// Una imagen RGBA de `ancho` x `alto` con la mitad izquierda transparente,
    /// guardada como PNG en un directorio propio de la prueba. Una mitad entera y
    /// no un píxel: al reducir, un píxel suelto se promedia con sus vecinos.
    fn imagen_de_prueba(nombre: &str, ancho: u32, alto: u32) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("vasak-thumb-img-{nombre}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut pixeles =
            image::RgbaImage::from_pixel(ancho, alto, image::Rgba([200, 30, 30, 255]));
        for x in 0..ancho / 2 {
            for y in 0..alto {
                pixeles.put_pixel(x, y, image::Rgba([0, 0, 0, 0]));
            }
        }
        let origen = dir.join("grande.png");
        pixeles.save(&origen).unwrap();
        (dir, origen)
    }

    #[test]
    fn la_miniatura_de_una_imagen_grande_sale_chica_y_conserva_la_proporcion() {
        // El objetivo de todo esto: que la vista no cargue 2000x1000 píxeles
        // para dibujar una tarjeta de 120.
        let (dir, origen) = imagen_de_prueba("tamano", 2000, 1000);
        let destino = dir.join("salida.png");

        let ruta = miniatura_de_imagen(&origen, &destino).unwrap();

        let chica = image::open(&ruta).unwrap();
        assert_eq!((chica.width(), chica.height()), (LADO, LADO / 2));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_miniatura_de_una_imagen_conserva_la_transparencia() {
        // Por eso es PNG y no JPEG: un logo con fondo transparente saldría negro.
        let (dir, origen) = imagen_de_prueba("alfa", 640, 640);
        let destino = dir.join("salida.png");

        miniatura_de_imagen(&origen, &destino).unwrap();

        let chica = image::open(&destino).unwrap().to_rgba8();
        assert_eq!(chica.get_pixel(2, LADO / 2).0[3], 0);
        assert_eq!(chica.get_pixel(LADO - 3, LADO / 2).0[3], 255);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn una_imagen_ya_chica_no_se_agranda() {
        let (dir, origen) = imagen_de_prueba("chica", 100, 80);
        let destino = dir.join("salida.png");

        miniatura_de_imagen(&origen, &destino).unwrap();

        let chica = image::open(&destino).unwrap();
        assert_eq!((chica.width(), chica.height()), (100, 80));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn una_imagen_rota_da_error_y_no_deja_nada_en_la_cache() {
        // Un archivo a medias como caché válida se vería roto para siempre: la
        // clave sólo cambia si cambia el tamaño o la fecha del original.
        let dir = std::env::temp_dir().join("vasak-thumb-img-rota");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let origen = dir.join("rota.png");
        std::fs::write(&origen, b"no soy un png").unwrap();
        let destino = dir.join("salida.png");

        assert!(miniatura_de_imagen(&origen, &destino).is_err());
        assert!(!destino.exists());
        let sobrantes = std::fs::read_dir(&dir).unwrap().count();
        assert_eq!(sobrantes, 1, "sólo el original: ni destino ni parciales");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_miniatura_respeta_la_orientacion_exif() {
        use image::ImageEncoder;

        // Una foto de celular se guarda acostada con una marca que dice «girala
        // 90°». El WebView la aplica al dibujar la imagen entera; si la
        // miniatura no lo hace, la tarjeta mostraría de costado lo que antes se
        // veía derecho.
        let exif_girada_90 = [
            b'I', b'I', 42, 0, 8, 0, 0, 0, // cabecera TIFF, little-endian
            1, 0, // una entrada
            0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, // Orientation = 6
            0, 0, 0, 0, // sin más directorios
        ];
        let dir = std::env::temp_dir().join("vasak-thumb-img-exif");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let origen = dir.join("celular.jpg");
        let pixeles = image::RgbImage::from_pixel(2000, 1000, image::Rgb([200, 30, 30]));
        let mut archivo = std::fs::File::create(&origen).unwrap();
        let mut codificador = image::codecs::jpeg::JpegEncoder::new(&mut archivo);
        codificador
            .set_exif_metadata(exif_girada_90.to_vec())
            .unwrap();
        codificador
            .write_image(pixeles.as_raw(), 2000, 1000, image::ExtendedColorType::Rgb8)
            .unwrap();
        drop(archivo);
        let destino = dir.join("salida.png");

        miniatura_de_imagen(&origen, &destino).unwrap();

        let chica = image::open(&destino).unwrap();
        assert_eq!((chica.width(), chica.height()), (LADO / 2, LADO));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn solo_se_toman_por_imagen_las_extensiones_que_se_decodifican() {
        for si in ["a.jpg", "a.JPEG", "a.png", "a.gif", "a.bmp", "a.webp"] {
            assert!(es_imagen(Path::new(si)), "{si}");
        }
        // SVG lo dibuja WebKit a la medida; un video o un archivo sin extensión
        // siguen el camino de ffmpeg.
        for no in ["a.svg", "a.mp4", "a.avif", "a"] {
            assert!(!es_imagen(Path::new(no)), "{no}");
        }
    }

    #[test]
    fn la_cache_cuelga_de_thumbnails() {
        // Bajo `thumbnails/` para que las herramientas que limpian cachés la
        // encuentren, aunque no sea la caché de freedesktop.
        assert_eq!(
            directorio_cache_bajo(Some(PathBuf::from("/home/pato/.cache"))),
            Some(PathBuf::from("/home/pato/.cache/thumbnails/vasak-video"))
        );
    }

    #[test]
    fn una_base_relativa_no_da_directorio() {
        // Justo abajo se hace `create_dir_all`, así que una base relativa
        // escribía las miniaturas bajo el directorio de trabajo del proceso y
        // devolvía `Some`: quien llama creía que la caché estaba bien.
        //
        // Las cuatro formas de no ser absoluta: la del nombre suelto es la que
        // se escapa cuando uno se acuerda sólo de la vacía.
        for relativa in ["", "cache", "./cache", "../cache"] {
            assert_eq!(
                directorio_cache_bajo(Some(PathBuf::from(relativa))),
                None,
                "una base de {relativa:?} no tiene que dar directorio"
            );
        }
        assert_eq!(directorio_cache_bajo(None), None);
    }
}
