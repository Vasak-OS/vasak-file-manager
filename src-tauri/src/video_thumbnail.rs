//! Miniaturas de video (ffmpeg) y de imagen (crate `image`), guardadas en la
//! **caché de miniaturas de freedesktop** (`~/.cache/thumbnails/`).
//!
//! Antes las generaba el frontend: creaba un `<video>`, lo buscaba al 10 % y
//! dibujaba el cuadro en un `<canvas>` **del tamaño del video**
//! (`canvas.width = video.videoWidth`), para después pedirle un JPEG. Un archivo
//! 4K decodificaba 8,3 millones de píxeles dentro del proceso de la interfaz
//! para producir una imagen de 200 píxeles de lado, y como no se guardaba en
//! ningún lado, volvía a hacerlo cada vez que se abría la carpeta.
//!
//! ffmpeg extrae y escala el cuadro de una sola pasada, fuera del proceso de la
//! interfaz, y el resultado queda en la caché compartida del escritorio: la
//! segunda visita a una carpeta no cuesta nada, y —a diferencia de la caché
//! propia que había antes— se **reutiliza** lo que ya generó tumbler u otra
//! aplicación, y lo que se genera acá lo reutilizan ellas. La miniatura lleva
//! los chunks `Thumb::URI` y `Thumb::MTime` que manda la especificación, y al
//! leer una ajena se comprueba que su `Thumb::MTime` coincida con el archivo
//! (si no, se regenera).

use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

/// Lado máximo de la miniatura.
///
/// Es el bucket `large` de freedesktop: la especificación fija 256 como máximo
/// para `thumbnails/large`, y escribir más grande ahí dejaría una miniatura que
/// el resto del escritorio consideraría inválida. La vista las dibuja bastante
/// más chicas.
const LADO: u32 = 256;

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

/// URI `file://` del archivo, percent-encoded como lo hacen tumbler y GNOME.
///
/// El nombre de la miniatura es el md5 de este URI, así que tiene que coincidir
/// byte a byte con el que calculan las otras aplicaciones o no se reutiliza
/// nada. Se deja sin escapar el mismo conjunto que `g_filename_to_uri`: los
/// caracteres no reservados, la barra y `!$&'()*+,;=:@`.
fn uri_de_archivo(ruta: &Path) -> String {
    let mut uri = String::from("file://");
    for &byte in ruta.as_os_str().as_bytes() {
        let sin_escapar = byte.is_ascii_alphanumeric() || b"-_.~/!$&'()*+,;=:@".contains(&byte);
        if sin_escapar {
            uri.push(byte as char);
        } else {
            uri.push('%');
            uri.push_str(&format!("{byte:02X}"));
        }
    }
    uri
}

/// Nombre del archivo de miniatura: md5 del URI en hexadecimal, `.png`.
fn nombre_de_miniatura(uri: &str) -> String {
    format!("{:x}.png", md5::compute(uri.as_bytes()))
}

/// Fecha de modificación del archivo en segundos desde época.
///
/// Con signo: un archivo anterior a 1970 tiene un mtime negativo. Con `u64` y
/// `duration_since(UNIX_EPOCH).ok()` ese caso daba `None`, y `miniatura` se
/// rajaba con «No se pudo leer el archivo» sin generar nada.
fn mtime_segundos(ruta: &Path) -> Option<i64> {
    let modificado = std::fs::metadata(ruta).ok()?.modified().ok()?;
    Some(match modificado.duration_since(std::time::UNIX_EPOCH) {
        Ok(desde) => desde.as_secs() as i64,
        Err(antes) => -(antes.duration().as_secs() as i64),
    })
}

/// La base de la caché, sólo si es absoluta.
///
/// La base pasa por `dirs` en vez de leerse acá: antes se aceptaba cualquier
/// valor de `XDG_CACHE_HOME`, incluida la cadena vacía y cualquier ruta
/// relativa, que el estándar manda ignorar — y como después se hace
/// `create_dir_all`, con una base relativa las miniaturas se escribían bajo el
/// directorio de trabajo del proceso sin que nada fallara. `dirs` implementa la
/// regla, y el filtro de absoluta cierra el caso de la cadena vacía.
fn base_valida(base: Option<PathBuf>) -> Option<PathBuf> {
    base.filter(|base| base.is_absolute())
}

/// Dónde iría un bucket bajo `base`, sin crear nada.
///
/// `base` es el directorio de caché (`~/.cache`); la toma por parámetro para que
/// las pruebas ejerciten el flujo con un directorio temporal, en vez de leer el
/// entorno global.
fn bucket_en(base: &Path, nombre: &str) -> PathBuf {
    base.join("thumbnails").join(nombre)
}

/// Bucket de la caché freedesktop, creado con los permisos que pide el estándar.
///
/// `700` en `thumbnails/` y en el bucket: son miniaturas de archivos del
/// usuario, no se comparten con otras cuentas. El `chmod` es best-effort: en un
/// filesystem sin permisos Unix (una caché en FAT, por ejemplo) falla, y fallar
/// cerrado dejaría al usuario sin ninguna miniatura.
fn asegurar_bucket(base: &Path, nombre: &str) -> Option<PathBuf> {
    let dir = bucket_en(base, nombre);
    std::fs::create_dir_all(&dir).ok()?;
    if let Some(padre) = dir.parent() {
        let _ = fijar_modo(padre, 0o700);
    }
    let _ = fijar_modo(&dir, 0o700);
    Some(dir)
}

fn fijar_modo(ruta: &Path, modo: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(ruta, std::fs::Permissions::from_mode(modo))
}

/// Si ya hay una miniatura compartida válida para `nombre`, su ruta.
///
/// Se recorren los buckets de mayor a menor utilidad para la grilla. Una
/// miniatura ajena sólo vale si su `Thumb::MTime` coincide con el archivo: si no,
/// es de una versión vieja y hay que regenerarla.
fn miniatura_compartida_valida(base: &Path, nombre: &str, mtime: i64) -> Option<PathBuf> {
    for bucket in ["large", "x-large", "xx-large", "normal"] {
        let ruta = bucket_en(base, bucket).join(nombre);
        if ruta.is_file() && mtime_de_png(&ruta) == Some(mtime) {
            return Some(ruta);
        }
    }
    None
}

/// Lee `Thumb::MTime` de los chunks de texto de un PNG.
fn mtime_de_png(ruta: &Path) -> Option<i64> {
    let archivo = std::fs::File::open(ruta).ok()?;
    let lector = png::Decoder::new(std::io::BufReader::new(archivo))
        .read_info()
        .ok()?;
    lector
        .info()
        .uncompressed_latin1_text
        .iter()
        .find(|chunk| chunk.keyword == "Thumb::MTime")
        .and_then(|chunk| chunk.text.trim().parse().ok())
}

/// Escribe `imagen` como PNG freedesktop válido, con `Thumb::URI` y `Thumb::MTime`.
///
/// A un temporal del mismo directorio y `rename` al final: ffmpeg o el encoder
/// escribiendo directo al destino dejan un PNG a medias si el proceso muere o si
/// dos generaciones del mismo archivo corren a la vez, y la vista lo mostraría
/// roto para siempre. `rename` en el mismo directorio es atómico.
fn escribir_png_freedesktop(
    imagen: &image::DynamicImage,
    uri: &str,
    mtime: i64,
    destino: &Path,
) -> Result<(), String> {
    let rgba = imagen.to_rgba8();
    let (ancho, alto) = (rgba.width(), rgba.height());

    // Un contador propio y no el PID: `std::process::id()` es el mismo para
    // todas las generaciones de este proceso, así que dos del mismo archivo en
    // paralelo escribirían el mismo temporal — y `rename` sólo es atómico si cada
    // escritor tiene el suyo.
    static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let parcial = destino.with_extension(format!("parcial-{}-{nonce}.png", std::process::id()));

    let escribir = || -> Result<(), String> {
        // `0o600` desde la creación, no un `chmod` posterior: así la miniatura no
        // pasa ni un instante con permisos más amplios. En un filesystem sin
        // permisos Unix el modo se ignora, igual que el `chmod` de antes.
        use std::os::unix::fs::OpenOptionsExt;
        let archivo = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&parcial)
            .map_err(|error| format!("no se pudo crear la miniatura: {error}"))?;
        let mut encoder = png::Encoder::new(std::io::BufWriter::new(archivo), ancho, alto);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let fallo =
            |error: png::EncodingError| format!("no se pudo escribir la miniatura: {error}");
        encoder
            .add_text_chunk("Thumb::URI".to_string(), uri.to_string())
            .map_err(fallo)?;
        encoder
            .add_text_chunk("Thumb::MTime".to_string(), mtime.to_string())
            .map_err(fallo)?;
        encoder
            .add_text_chunk("Software".to_string(), "vasak-file-manager".to_string())
            .map_err(fallo)?;
        let mut writer = encoder
            .write_header()
            .map_err(|error| format!("no se pudo escribir la miniatura: {error}"))?;
        writer
            .write_image_data(rgba.as_raw())
            .map_err(|error| format!("no se pudo escribir la miniatura: {error}"))?;
        writer
            .finish()
            .map_err(|error| format!("no se pudo cerrar la miniatura: {error}"))?;
        Ok(())
    };

    if let Err(error) = escribir() {
        let _ = std::fs::remove_file(&parcial);
        return Err(error);
    }

    std::fs::rename(&parcial, destino).map_err(|error| {
        let _ = std::fs::remove_file(&parcial);
        format!("no se pudo guardar la miniatura: {error}")
    })
}

/// Devuelve la ruta de la miniatura de `archivo`, generándola si hace falta.
///
/// Devuelve la ruta y no los bytes: la vista la carga con el protocolo de
/// archivos, así que la imagen no cruza el IPC. Antes viajaba como data URL en
/// base64, o sea un tercio más de bytes por cada miniatura de cada carpeta.
pub fn miniatura(archivo: &Path) -> Result<PathBuf, String> {
    let base = base_valida(dirs::cache_dir()).ok_or("No se pudo ubicar la caché de miniaturas")?;
    miniatura_en(&base, archivo)
}

/// El cuerpo de [`miniatura`], con la base de la caché por parámetro.
///
/// Separado para poder probar todo el flujo —reutilización, generación y
/// escritura— contra un directorio temporal, sin tocar `~/.cache` ni el entorno.
fn miniatura_en(base: &Path, archivo: &Path) -> Result<PathBuf, String> {
    if !archivo.is_file() {
        return Err("El archivo no existe".to_string());
    }

    let mtime = mtime_segundos(archivo).ok_or("No se pudo leer el archivo")?;
    let uri = uri_de_archivo(archivo);
    let nombre = nombre_de_miniatura(&uri);

    if let Some(ruta) = miniatura_compartida_valida(base, &nombre, mtime) {
        return Ok(ruta);
    }

    let dir = asegurar_bucket(base, "large").ok_or("No se pudo crear la caché de miniaturas")?;
    let destino = dir.join(&nombre);

    // Otra generación en paralelo pudo haberla dejado ya, y válida.
    if destino.is_file() && mtime_de_png(&destino) == Some(mtime) {
        return Ok(destino);
    }

    let imagen = if es_imagen(archivo) {
        imagen_reducida(archivo)?
    } else {
        cuadro_de_video(archivo, &dir)?
    };

    escribir_png_freedesktop(&imagen, &uri, mtime, &destino)?;
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

/// Miniatura de una imagen (≤ [`LADO`]) como `DynamicImage`, sin tocar disco.
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
fn imagen_reducida(origen: &Path) -> Result<image::DynamicImage, String> {
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
    // `thumbnail` también agranda: un icono de 64 px saldría de 256.
    Ok(if imagen.width() <= LADO && imagen.height() <= LADO {
        imagen
    } else {
        imagen.thumbnail(LADO, LADO)
    })
}

/// Cuadro del video (≤ [`LADO`]) como `DynamicImage`, extraído por ffmpeg.
///
/// ffmpeg escribe un PNG temporal en `dir_tmp` (el propio bucket de la caché) y
/// acá se lee: así el encoder de [`escribir_png_freedesktop`] le pone los chunks
/// `Thumb::*` que ffmpeg no sabe escribir.
fn cuadro_de_video(video: &Path, dir_tmp: &Path) -> Result<image::DynamicImage, String> {
    // `-ss` antes de `-i` busca por índice sin decodificar lo anterior, que es la
    // diferencia entre leer un cuadro y leer el archivo entero. Al 10 % del video
    // en lugar del principio, porque muchos empiezan en negro.
    let posicion = duracion(video).map(|d| d * 0.1).unwrap_or(1.0).max(0.0);

    static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let parcial = dir_tmp.join(format!("vasak-ffmpeg-{}-{nonce}.png", std::process::id()));

    let mut orden = Command::new("ffmpeg");
    orden
        .args(["-v", "error", "-nostdin"])
        .args(["-ss", &format!("{posicion:.3}")])
        .arg("-i")
        .arg(video)
        .args(["-frames:v", "1"])
        // Acota las DOS dimensiones a `LADO`: con `-2` en una, un video vertical
        // (1080×1920) daba 256×456 y se guardaba en `large`, que sólo admite hasta
        // 256 de lado. `force_original_aspect_ratio=decrease` encaja el cuadro
        // dentro de la caja sin deformarlo, y `min(...,iw/ih)` evita agrandar uno
        // más chico.
        .args([
            "-vf",
            &format!(
                "scale='min({LADO},iw)':'min({LADO},ih)':force_original_aspect_ratio=decrease"
            ),
        ])
        .arg("-y")
        .arg(&parcial);

    let salida = con_plazo(orden).inspect_err(|_| {
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

    let imagen =
        image::open(&parcial).map_err(|error| format!("no se pudo decodificar el cuadro: {error}"));
    let _ = std::fs::remove_file(&parcial);
    imagen
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
    fn el_uri_escapa_el_espacio_y_deja_la_barra() {
        // El md5 del nombre tiene que coincidir con el de tumbler/GNOME: el
        // espacio va a `%20` y la barra separadora queda tal cual.
        let uri = uri_de_archivo(Path::new("/home/u/My Video.mp4"));
        assert_eq!(uri, "file:///home/u/My%20Video.mp4");
    }

    #[test]
    fn el_nombre_es_estable_para_la_misma_ruta() {
        // Si no fuera estable, la caché no serviría de nada.
        let uno = nombre_de_miniatura(&uri_de_archivo(Path::new("/x/y.mp4")));
        let dos = nombre_de_miniatura(&uri_de_archivo(Path::new("/x/y.mp4")));
        assert_eq!(uno, dos);
        assert!(uno.ends_with(".png"));
    }

    #[test]
    fn la_base_ignora_una_ruta_relativa_o_vacia() {
        // El estándar manda ignorar un `XDG_CACHE_HOME` que no sea absoluto, y
        // con `create_dir_all` una base relativa escribiría bajo el directorio
        // de trabajo del proceso.
        assert!(base_valida(Some(PathBuf::from("relativo"))).is_none());
        assert!(base_valida(Some(PathBuf::from(""))).is_none());
        assert!(base_valida(Some(PathBuf::from("/abs"))).is_some());
    }

    /// Directorio temporal propio de cada prueba, sin tocar `HOME` ni el entorno.
    struct Tmp(PathBuf);

    impl Tmp {
        fn nuevo(etiqueta: &str) -> Self {
            static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "vfm-miniatura-{etiqueta}-{}-{n}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Tmp(dir)
        }
    }

    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn imagen_chica() -> image::DynamicImage {
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            4,
            3,
            image::Rgba([10, 20, 30, 255]),
        ))
    }

    #[test]
    fn el_mtime_escrito_en_el_png_se_lee_igual() {
        let tmp = Tmp::nuevo("ida-y-vuelta");
        let destino = tmp.0.join("a.png");

        escribir_png_freedesktop(&imagen_chica(), "file:///x/a.mp4", 1_700_000_123, &destino)
            .unwrap();

        assert_eq!(mtime_de_png(&destino), Some(1_700_000_123));
        let leida = image::open(&destino).unwrap();
        assert_eq!((leida.width(), leida.height()), (4, 3));
    }

    #[test]
    fn el_png_guarda_el_uri_y_no_deja_parciales() {
        let tmp = Tmp::nuevo("uri");
        let destino = tmp.0.join("b.png");

        escribir_png_freedesktop(&imagen_chica(), "file:///x/b.mp4", 7, &destino).unwrap();

        let lector = png::Decoder::new(std::io::BufReader::new(
            std::fs::File::open(&destino).unwrap(),
        ))
        .read_info()
        .unwrap();
        let uri = lector
            .info()
            .uncompressed_latin1_text
            .iter()
            .find(|chunk| chunk.keyword == "Thumb::URI")
            .map(|chunk| chunk.text.clone());
        assert_eq!(uri.as_deref(), Some("file:///x/b.mp4"));
        let sobrantes = std::fs::read_dir(&tmp.0).unwrap().count();
        assert_eq!(sobrantes, 1, "el temporal tiene que renombrarse al destino");
    }

    #[test]
    fn un_png_sin_el_chunk_de_mtime_no_vale() {
        // Una miniatura ajena sin `Thumb::MTime` no se puede dar por vigente.
        let tmp = Tmp::nuevo("sin-chunk");
        let destino = tmp.0.join("c.png");
        imagen_chica().save(&destino).unwrap();

        assert_eq!(mtime_de_png(&destino), None);
    }

    #[test]
    fn un_png_con_otro_mtime_no_coincide_con_el_del_archivo() {
        // `miniatura_compartida_valida` compara contra el mtime del archivo: una
        // miniatura de una versión vieja tiene que quedar fuera.
        let tmp = Tmp::nuevo("mtime-viejo");
        let destino = tmp.0.join("d.png");
        escribir_png_freedesktop(&imagen_chica(), "file:///x/d.mp4", 100, &destino).unwrap();

        assert_ne!(mtime_de_png(&destino), Some(200));
        assert_eq!(mtime_de_png(&destino), Some(100));
    }

    #[test]
    fn un_archivo_inexistente_o_que_no_es_png_no_tiene_mtime() {
        let tmp = Tmp::nuevo("invalido");
        let basura = tmp.0.join("e.png");
        std::fs::write(&basura, b"esto no es un png").unwrap();

        assert_eq!(mtime_de_png(&basura), None);
        assert_eq!(mtime_de_png(&tmp.0.join("no-existe.png")), None);
    }

    #[test]
    fn el_mtime_negativo_antes_de_epoca_se_lee_igual() {
        // Un archivo anterior a 1970 tiene mtime negativo; el chunk y su lectura
        // tienen que preservarlo.
        let tmp = Tmp::nuevo("pre-epoca");
        let destino = tmp.0.join("neg.png");

        escribir_png_freedesktop(&imagen_chica(), "file:///x/neg.mp4", -86_400, &destino).unwrap();

        assert_eq!(mtime_de_png(&destino), Some(-86_400));
    }

    /// Guarda `imagen` como PNG en `origen` y devuelve su mtime.
    fn imagen_en_disco(origen: &Path, lado: u32) -> i64 {
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            lado,
            lado,
            image::Rgba([1, 2, 3, 255]),
        ))
        .save(origen)
        .unwrap();
        mtime_segundos(origen).unwrap()
    }

    #[test]
    fn genera_la_miniatura_de_una_imagen_en_large_con_permisos_600() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = Tmp::nuevo("imagen");
        let origen = tmp.0.join("foto.png");
        // Más grande que `LADO` para ejercitar el reescalado.
        let mtime = imagen_en_disco(&origen, 600);
        let base = tmp.0.join("cache");

        let destino = miniatura_en(&base, &origen).unwrap();

        assert!(destino.starts_with(bucket_en(&base, "large")));
        assert!(destino.is_file());
        let mini = image::open(&destino).unwrap();
        assert!(mini.width() <= LADO && mini.height() <= LADO);
        assert_eq!(mtime_de_png(&destino), Some(mtime));
        assert_eq!(
            std::fs::metadata(&destino).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn la_segunda_vez_reutiliza_y_otro_mtime_no_vale() {
        let tmp = Tmp::nuevo("reuso");
        let origen = tmp.0.join("foto.png");
        imagen_en_disco(&origen, 64);
        let base = tmp.0.join("cache");

        let primera = miniatura_en(&base, &origen).unwrap();
        let segunda = miniatura_en(&base, &origen).unwrap();
        assert_eq!(
            primera, segunda,
            "la segunda tiene que reutilizar la primera"
        );

        // Una miniatura guardada con un mtime no sirve para otro: hay que regenerar.
        let nombre = nombre_de_miniatura(&uri_de_archivo(&origen));
        assert!(miniatura_compartida_valida(&base, &nombre, 999_999).is_none());
    }

    #[test]
    fn una_ruta_que_no_es_archivo_no_tiene_miniatura() {
        let tmp = Tmp::nuevo("sin-archivo");
        let base = tmp.0.join("cache");
        assert!(miniatura_en(&base, &tmp.0.join("no-existe.png")).is_err());
    }
}
