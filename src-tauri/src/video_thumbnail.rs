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
fn mtime_segundos(ruta: &Path) -> Option<u64> {
    std::fs::metadata(ruta)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

/// Dónde iría un bucket de la caché, sin crear nada y sin leer el entorno.
///
/// Aparte para poder probar la decisión sin tocar el disco. La base pasa por
/// `dirs` en vez de leerse acá: antes se aceptaba cualquier valor de
/// `XDG_CACHE_HOME`, incluida la cadena vacía y cualquier ruta relativa, que el
/// estándar manda ignorar — y como después se hace `create_dir_all`, con una
/// base relativa las miniaturas se escribían bajo el directorio de trabajo del
/// proceso sin que nada fallara. `dirs` implementa la regla, y el filtro de
/// absoluta cierra el caso de la cadena vacía.
fn bucket_bajo(base: Option<PathBuf>, nombre: &str) -> Option<PathBuf> {
    let base = base.filter(|base| base.is_absolute())?;
    Some(base.join("thumbnails").join(nombre))
}

/// Bucket de la caché freedesktop, creado con los permisos que pide el estándar.
///
/// `700` en `thumbnails/` y en el bucket: son miniaturas de archivos del
/// usuario, no se comparten con otras cuentas.
fn bucket_cache(nombre: &str) -> Option<PathBuf> {
    let dir = bucket_bajo(dirs::cache_dir(), nombre)?;
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
fn miniatura_compartida_valida(nombre: &str, mtime: u64) -> Option<PathBuf> {
    for bucket in ["large", "x-large", "xx-large", "normal"] {
        let ruta = bucket_bajo(dirs::cache_dir(), bucket)?.join(nombre);
        if ruta.is_file() && mtime_de_png(&ruta) == Some(mtime) {
            return Some(ruta);
        }
    }
    None
}

/// Lee `Thumb::MTime` de los chunks de texto de un PNG.
fn mtime_de_png(ruta: &Path) -> Option<u64> {
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
    mtime: u64,
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
        let archivo = std::fs::File::create(&parcial)
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
        let _ = fijar_modo(&parcial, 0o600);
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
    if !archivo.is_file() {
        return Err("El archivo no existe".to_string());
    }

    let mtime = mtime_segundos(archivo).ok_or("No se pudo leer el archivo")?;
    let uri = uri_de_archivo(archivo);
    let nombre = nombre_de_miniatura(&uri);

    if let Some(ruta) = miniatura_compartida_valida(&nombre, mtime) {
        return Ok(ruta);
    }

    let dir = bucket_cache("large").ok_or("No se pudo crear la caché de miniaturas")?;
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
        // `force_original_aspect_ratio=decrease` con `-2` en un lado deforma
        // menos que fijar los dos; `scale` sólo reduce.
        .args([
            "-vf",
            &format!("scale='min({LADO},iw)':-2:force_original_aspect_ratio=decrease"),
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
    fn el_bucket_ignora_una_base_relativa_o_vacia() {
        // El estándar manda ignorar un `XDG_CACHE_HOME` que no sea absoluto, y
        // con `create_dir_all` una base relativa escribiría bajo el directorio
        // de trabajo del proceso.
        assert!(bucket_bajo(Some(PathBuf::from("relativo")), "large").is_none());
        assert!(bucket_bajo(Some(PathBuf::from("")), "large").is_none());
        assert!(bucket_bajo(Some(PathBuf::from("/abs")), "large").is_some());
    }
}
