//! Miniaturas de video (ffmpeg), de imagen (crate `image`), de PDF (pdftoppm) y
//! de fuentes (ab_glyph), guardadas en la **caché de miniaturas de freedesktop**
//! (`~/.cache/thumbnails/`).
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
    // El nombre real del programa (ffmpeg, ffprobe o pdftoppm): el mensaje de
    // «no instalado» lo nombra en vez de suponer ffmpeg.
    let programa = orden.get_program().to_string_lossy().into_owned();
    let mut hijo = orden
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                format!("{programa} no está instalado")
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
    } else if es_pdf(archivo) {
        miniatura_pdf(archivo, &dir)?
    } else if es_fuente(archivo) {
        miniatura_fuente(archivo)?
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

    // ffmpeg crea el temporal con el umask del proceso; se restringe a `0o600`
    // apenas termina. El directorio ya es `0o700`, así que esto sólo acota la
    // ventana en que el archivo —de vida muy corta— queda con permisos más
    // amplios mientras ffmpeg lo escribe.
    let _ = fijar_modo(&parcial, 0o600);

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

/// Un PDF por la extensión.
pub(crate) fn es_pdf(ruta: &Path) -> bool {
    ruta.extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

/// Miniatura de la primera página de un PDF (≤ [`LADO`]), vía `pdftoppm`.
///
/// `pdftoppm` escribe un PNG temporal en `dir_tmp` (el bucket de la caché) y acá
/// se lee, igual que [`cuadro_de_video`], para que el encoder de
/// [`escribir_png_freedesktop`] le ponga los chunks `Thumb::*`. Si `pdftoppm` no
/// está (`poppler`, un `optdepends`) o el PDF no abre, devuelve `Err` y la vista
/// se queda con el icono genérico.
fn miniatura_pdf(pdf: &Path, dir_tmp: &Path) -> Result<image::DynamicImage, String> {
    static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let base = format!("vasak-pdftoppm-{}-{nonce}", std::process::id());

    let mut orden = Command::new("pdftoppm");
    orden
        .args(["-f", "1", "-l", "1", "-png", "-scale-to", &LADO.to_string()])
        .arg(pdf)
        .arg(dir_tmp.join(&base));

    let salida = con_plazo(orden);

    // `pdftoppm` nombra la salida `<base>-<página>.png`, con el número de página
    // rellenado con ceros según la cantidad de páginas del documento (`-1.png`,
    // `-01.png`, `-001.png`…). Se busca por prefijo en vez de asumir un patrón.
    let generado = png_generado(dir_tmp, &base);

    let salida = match salida {
        Ok(salida) => salida,
        Err(error) => {
            if let Some(ruta) = generado {
                let _ = std::fs::remove_file(ruta);
            }
            return Err(error);
        }
    };

    let Some(generado) = generado else {
        let detalle = String::from_utf8_lossy(&salida.stderr).trim().to_string();
        return Err(if detalle.is_empty() {
            "pdftoppm no pudo renderizar la primera página".to_string()
        } else {
            detalle
        });
    };

    if !salida.status.success() {
        let _ = std::fs::remove_file(&generado);
        let detalle = String::from_utf8_lossy(&salida.stderr).trim().to_string();
        return Err(if detalle.is_empty() {
            "pdftoppm no pudo renderizar la primera página".to_string()
        } else {
            detalle
        });
    }

    // Mismo motivo que en `cuadro_de_video`: `pdftoppm` crea el temporal con el
    // umask del proceso y se acota a `0o600` apenas termina.
    let _ = fijar_modo(&generado, 0o600);

    let imagen =
        image::open(&generado).map_err(|error| format!("no se pudo decodificar el PDF: {error}"));
    let _ = std::fs::remove_file(&generado);
    imagen
}

/// Primer PNG de `dir` cuyo nombre empieza con `base`, si hay alguno.
pub(crate) fn png_generado(dir: &Path, base: &str) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entrada| entrada.path())
        .find(|ruta| {
            ruta.file_name()
                .and_then(std::ffi::OsStr::to_str)
                .is_some_and(|nombre| nombre.starts_with(base) && nombre.ends_with(".png"))
        })
}

/// Pangram de la miniatura de una fuente, en dos líneas para que entre más grande.
const PANGRAM: [&str; 2] = ["The quick brown fox", "jumps over the lazy dog"];

/// Una fuente por la extensión.
pub(crate) fn es_fuente(ruta: &Path) -> bool {
    // shortcut: sólo ttf/otf, no woff2/woff ni .ttc por índice; sumar cuando haga falta.
    ruta.extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|e| ["ttf", "otf"].iter().any(|c| e.eq_ignore_ascii_case(c)))
}

/// Escala en px para que un texto que mide `ancho_a_1px` (con `PxScale` 1.0) entre
/// en `objetivo` de ancho, sin pasar de `maxima`.
///
/// El avance de un glifo es lineal con la escala, así que basta medir a 1 px y
/// dividir. Puro para poder probarlo sin leer una fuente.
pub(crate) fn escala_para_ancho(ancho_a_1px: f32, objetivo: f32, maxima: f32) -> f32 {
    if ancho_a_1px <= 0.0 {
        return maxima;
    }
    (objetivo / ancho_a_1px).min(maxima)
}

/// Miniatura de una fuente (≤ [`LADO`]): el pangram rasterizado con `ab_glyph`.
///
/// La fuente es un archivo de entrada no confiable: `FontVec::try_from_vec`
/// valida y devuelve `Err` ante una fuente corrupta, nunca entra en pánico. El
/// layout es a propósito simple (una escala uniforme por líneas, sin shaping ni
/// kerning): es una vista previa, no composición tipográfica.
fn miniatura_fuente(archivo: &Path) -> Result<image::DynamicImage, String> {
    use ab_glyph::{point, Font, FontVec, PxScale, ScaleFont};

    let bytes =
        std::fs::read(archivo).map_err(|error| format!("no se pudo leer la fuente: {error}"))?;
    let font = FontVec::try_from_vec(bytes).map_err(|_| "la fuente no es válida".to_string())?;

    // Ancho de cada línea a 1 px, para elegir la escala que entra en la caja.
    let a_1px = font.as_scaled(1.0_f32);
    let ancho_1 = |linea: &str| {
        linea
            .chars()
            .map(|c| a_1px.h_advance(font.glyph_id(c)))
            .sum::<f32>()
    };
    let ancho_max = PANGRAM.iter().map(|l| ancho_1(l)).fold(0.0_f32, f32::max);

    let margen = 12.0_f32;
    let objetivo = LADO as f32 - 2.0 * margen;
    let escala = escala_para_ancho(ancho_max, objetivo, 64.0);
    let fuente = font.as_scaled(PxScale::from(escala));
    let alto_linea = fuente.height() + fuente.line_gap();

    let ancho_img = ((ancho_max * escala).ceil() as u32 + 2 * margen as u32).clamp(1, LADO);
    let alto_img =
        ((alto_linea * PANGRAM.len() as f32).ceil() as u32 + 2 * margen as u32).clamp(1, LADO);

    // Fondo claro, glifos oscuros.
    let mut lienzo =
        image::RgbaImage::from_pixel(ancho_img, alto_img, image::Rgba([246, 246, 246, 255]));

    for (i, linea) in PANGRAM.iter().enumerate() {
        let base_y = margen + fuente.ascent() + i as f32 * alto_linea;
        let mut x = margen;
        for c in linea.chars() {
            let id = font.glyph_id(c);
            let glifo = id.with_scale_and_position(PxScale::from(escala), point(x, base_y));
            if let Some(contorno) = font.outline_glyph(glifo) {
                let caja = contorno.px_bounds();
                contorno.draw(|gx, gy, cobertura| {
                    let px = caja.min.x as i32 + gx as i32;
                    let py = caja.min.y as i32 + gy as i32;
                    if px >= 0 && py >= 0 && (px as u32) < ancho_img && (py as u32) < alto_img {
                        let fondo = lienzo.get_pixel(px as u32, py as u32).0;
                        let mezcla =
                            |f: u8| (f as f32 * (1.0 - cobertura) + 32.0 * cobertura) as u8;
                        lienzo.put_pixel(
                            px as u32,
                            py as u32,
                            image::Rgba([
                                mezcla(fondo[0]),
                                mezcla(fondo[1]),
                                mezcla(fondo[2]),
                                255,
                            ]),
                        );
                    }
                });
            }
            x += fuente.h_advance(id);
        }
    }

    Ok(image::DynamicImage::ImageRgba8(lienzo))
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

    // ---- PDF y fuentes (#151) ----

    #[test]
    fn es_pdf_mira_la_extension_sin_distinguir_mayusculas() {
        assert!(es_pdf(Path::new("/x/manual.pdf")));
        assert!(es_pdf(Path::new("/x/MANUAL.PDF")));
        assert!(!es_pdf(Path::new("/x/manual.txt")));
        assert!(!es_pdf(Path::new("/x/manual.pdf.bak")));
        assert!(!es_pdf(Path::new("/x/pdf")));
        assert!(!es_pdf(Path::new("/x/manual")));
    }

    #[test]
    fn es_fuente_acepta_ttf_y_otf_y_deja_afuera_lo_demas() {
        assert!(es_fuente(Path::new("/x/letra.ttf")));
        assert!(es_fuente(Path::new("/x/letra.otf")));
        assert!(es_fuente(Path::new("/x/LETRA.TTF")));
        assert!(es_fuente(Path::new("/x/LETRA.OTF")));
        // Límite declarado: sin woff/woff2 ni colecciones .ttc.
        assert!(!es_fuente(Path::new("/x/letra.woff")));
        assert!(!es_fuente(Path::new("/x/letra.woff2")));
        assert!(!es_fuente(Path::new("/x/letra.ttc")));
        assert!(!es_fuente(Path::new("/x/letra.txt")));
        assert!(!es_fuente(Path::new("/x/letra")));
    }

    #[test]
    fn la_escala_sale_de_dividir_el_objetivo_por_el_ancho_a_un_pixel() {
        assert_eq!(escala_para_ancho(10.0, 200.0, 64.0), 20.0);
        assert_eq!(escala_para_ancho(100.0, 50.0, 64.0), 0.5);
    }

    #[test]
    fn la_escala_no_pasa_de_la_maxima() {
        // Un texto muy corto daría una escala enorme: se satura.
        assert_eq!(escala_para_ancho(1.0, 232.0, 64.0), 64.0);
        assert_eq!(escala_para_ancho(0.001, 232.0, 64.0), 64.0);
    }

    #[test]
    fn la_escala_sin_ancho_medible_es_la_maxima() {
        // Una fuente sin los glifos del pangram mide cero: no se divide por cero.
        assert_eq!(escala_para_ancho(0.0, 232.0, 64.0), 64.0);
        assert_eq!(escala_para_ancho(-3.0, 232.0, 64.0), 64.0);
    }

    fn con_archivos(etiqueta: &str, nombres: &[&str]) -> Tmp {
        let tmp = Tmp::nuevo(etiqueta);
        for nombre in nombres {
            std::fs::write(tmp.0.join(nombre), b"x").unwrap();
        }
        tmp
    }

    #[test]
    fn png_generado_encuentra_el_png_sea_cual_sea_el_relleno_de_pdftoppm() {
        // `pdftoppm` rellena el número de página con ceros según las páginas del PDF.
        for sufijo in ["base-1.png", "base-01.png", "base-001.png"] {
            let tmp = con_archivos("png-sufijo", &[sufijo]);
            assert_eq!(
                png_generado(&tmp.0, "base"),
                Some(tmp.0.join(sufijo)),
                "no encontró {sufijo}"
            );
        }
    }

    #[test]
    fn png_generado_ignora_lo_que_no_es_suyo() {
        let tmp = con_archivos(
            "png-ajenos",
            &["otro-1.png", "xbase-1.png", "base-1.txt", "base-1.png.tmp"],
        );
        assert_eq!(png_generado(&tmp.0, "base"), None);

        std::fs::write(tmp.0.join("base-1.png"), b"x").unwrap();
        assert_eq!(png_generado(&tmp.0, "base"), Some(tmp.0.join("base-1.png")));
    }

    #[test]
    fn png_generado_sin_ninguno_o_sin_directorio_es_none() {
        let tmp = Tmp::nuevo("png-vacio");
        assert_eq!(png_generado(&tmp.0, "base"), None);
        assert_eq!(png_generado(&tmp.0.join("no-existe"), "base"), None);
    }

    /// Una fuente TrueType mínima armada a mano: dos glifos (el `.notdef` vacío y
    /// un cuadrado) y un `cmap` que sólo mapea la «T». Sin tablas opcionales; sirve
    /// para no depender de qué fuentes tenga el runner.
    fn fuente_minima() -> Vec<u8> {
        fn u16s(valores: &[u16]) -> Vec<u8> {
            valores.iter().flat_map(|v| v.to_be_bytes()).collect()
        }
        fn i16s(valores: &[i16]) -> Vec<u8> {
            valores.iter().flat_map(|v| v.to_be_bytes()).collect()
        }

        let mut head = vec![0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x5F, 0x0F, 0x3C, 0xF5];
        head.extend(u16s(&[0, 1000])); // flags, unitsPerEm
        head.extend([0u8; 16]); // created, modified
        head.extend(i16s(&[0, 0, 500, 700])); // caja de la fuente
        head.extend(u16s(&[0, 8]));
        head.extend(i16s(&[2, 0, 0])); // dirección, loca corto, formato de glifo

        let mut hhea = vec![0, 1, 0, 0];
        hhea.extend(i16s(&[800, -200, 0]));
        hhea.extend(u16s(&[600, 0, 0, 500, 1, 0, 0, 0, 0, 0, 0, 0, 2]));

        let hmtx = [u16s(&[600, 0]), u16s(&[600, 0])].concat();

        let mut maxp = vec![0, 1, 0, 0];
        maxp.extend(u16s(&[2, 4, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]));

        // Segmentos: «T» -> glifo 1, y el 0xFFFF de cierre.
        let mut cmap = u16s(&[0, 1, 3, 1, 0, 12]);
        cmap.extend(u16s(&[4, 32, 0, 4, 4, 1, 0]));
        cmap.extend(u16s(&[0x54, 0xFFFF, 0]));
        cmap.extend(u16s(&[0x54, 0xFFFF]));
        cmap.extend(u16s(&[1u16.wrapping_sub(0x54), 1]));
        cmap.extend(u16s(&[0, 0]));

        // Glifo 1: un cuadrado de 500 x 700 con los cuatro puntos en la curva.
        let mut glyf = i16s(&[1, 0, 0, 500, 700]);
        glyf.extend(u16s(&[3, 0]));
        glyf.extend([1, 1, 1, 1]);
        glyf.extend(i16s(&[0, 500, 0, -500, 0, 0, 700, 0]));
        let loca = u16s(&[0, 0, (glyf.len() / 2) as u16]);

        let tablas: [(&[u8; 4], Vec<u8>); 7] = [
            (b"cmap", cmap),
            (b"glyf", glyf),
            (b"head", head),
            (b"hhea", hhea),
            (b"hmtx", hmtx),
            (b"loca", loca),
            (b"maxp", maxp),
        ];
        let mut salida = vec![0, 1, 0, 0];
        salida.extend(u16s(&[7, 64, 2, 48]));
        let mut offset = 12 + 16 * tablas.len();
        let mut cuerpo = Vec::new();
        for (tag, datos) in &tablas {
            salida.extend(*tag);
            salida.extend([0u8; 4]); // el checksum no se valida
            salida.extend((offset as u32).to_be_bytes());
            salida.extend((datos.len() as u32).to_be_bytes());
            cuerpo.extend(datos);
            while cuerpo.len() % 4 != 0 {
                cuerpo.push(0);
            }
            offset = 12 + 16 * tablas.len() + cuerpo.len();
        }
        salida.extend(cuerpo);
        salida
    }

    #[test]
    fn una_fuente_corrupta_da_error_y_no_entra_en_panico() {
        let tmp = Tmp::nuevo("fuente-corrupta");
        let basura = tmp.0.join("rota.ttf");
        std::fs::write(&basura, b"esto no es una fuente").unwrap();

        assert_eq!(
            miniatura_fuente(&basura).err().as_deref(),
            Some("la fuente no es válida")
        );
        // Una fuente cortada a la mitad tampoco.
        let entera = fuente_minima();
        std::fs::write(&basura, &entera[..entera.len() / 2]).unwrap();
        assert!(miniatura_fuente(&basura).is_err());
    }

    #[test]
    fn una_fuente_que_no_existe_da_error() {
        let tmp = Tmp::nuevo("fuente-ausente");
        let error = miniatura_fuente(&tmp.0.join("no-existe.ttf")).unwrap_err();
        assert!(error.starts_with("no se pudo leer la fuente"), "{error}");
    }

    #[test]
    fn la_miniatura_de_una_fuente_valida_entra_en_el_lado_y_dibuja_glifos() {
        let tmp = Tmp::nuevo("fuente-valida");
        let ruta = tmp.0.join("minima.ttf");
        std::fs::write(&ruta, fuente_minima()).unwrap();

        let imagen = miniatura_fuente(&ruta).unwrap();

        assert!(imagen.width() >= 1 && imagen.width() <= LADO);
        assert!(imagen.height() >= 1 && imagen.height() <= LADO);
        // El fondo es claro (246): si hay un píxel oscuro, se rasterizó la «T».
        let dibujo = imagen
            .to_rgba8()
            .pixels()
            .filter(|pixel| pixel.0[0] < 128)
            .count();
        assert!(dibujo > 0, "la miniatura quedó en blanco");
    }

    #[test]
    fn la_miniatura_de_una_fuente_se_guarda_en_la_cache_con_permisos_600() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = Tmp::nuevo("fuente-cache");
        let origen = tmp.0.join("minima.otf");
        std::fs::write(&origen, fuente_minima()).unwrap();
        let base = tmp.0.join("cache");

        let destino = miniatura_en(&base, &origen).unwrap();

        assert!(destino.starts_with(bucket_en(&base, "large")));
        let mini = image::open(&destino).unwrap();
        assert!(mini.width() <= LADO && mini.height() <= LADO);
        assert_eq!(mtime_de_png(&destino), mtime_segundos(&origen));
        assert_eq!(
            std::fs::metadata(&destino).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn una_fuente_corrupta_no_deja_miniatura_en_la_cache() {
        let tmp = Tmp::nuevo("fuente-rota-cache");
        let origen = tmp.0.join("rota.ttf");
        std::fs::write(&origen, b"basura").unwrap();
        let base = tmp.0.join("cache");

        assert!(miniatura_en(&base, &origen).is_err());
        let destino = bucket_en(&base, "large").join(nombre_de_miniatura(&uri_de_archivo(&origen)));
        assert!(!destino.exists());
    }

    /// Un PDF de una página (300 x 400) con un rectángulo azul, con el `xref` calculado.
    fn pdf_minimo() -> Vec<u8> {
        let flujo = "0 0 1 rg 50 50 200 300 re f";
        let objetos = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R >>".to_string(),
            format!("<< /Length {} >>\nstream\n{flujo}\nendstream", flujo.len()),
        ];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (i, objeto) in objetos.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend(format!("{} 0 obj\n{objeto}\nendobj\n", i + 1).bytes());
        }
        let xref = pdf.len();
        pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objetos.len() + 1).bytes());
        for offset in offsets {
            pdf.extend(format!("{offset:010} 00000 n \n").bytes());
        }
        pdf.extend(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                objetos.len() + 1
            )
            .bytes(),
        );
        pdf
    }

    /// `pdftoppm` es de `poppler`, un `optdepends`: sin él no hay nada que probar.
    fn hay_pdftoppm() -> bool {
        Command::new("pdftoppm").arg("-v").output().is_ok()
    }

    #[test]
    fn la_miniatura_de_un_pdf_es_la_primera_pagina_y_no_deja_temporales() {
        if !hay_pdftoppm() {
            eprintln!("pdftoppm no está instalado: se omite la prueba");
            return;
        }
        let tmp = Tmp::nuevo("pdf-valido");
        let pdf = tmp.0.join("manual.pdf");
        std::fs::write(&pdf, pdf_minimo()).unwrap();
        let dir_tmp = tmp.0.join("tmp");
        std::fs::create_dir_all(&dir_tmp).unwrap();

        let imagen = miniatura_pdf(&pdf, &dir_tmp).unwrap();

        // Página de 300 x 400 con `-scale-to 256`: el lado mayor es `LADO`.
        assert_eq!(imagen.height(), LADO);
        assert!(imagen.width() > 0 && imagen.width() < LADO);
        // Se dibujó el rectángulo azul: hay píxeles que no son blancos.
        assert!(imagen.to_rgba8().pixels().any(|pixel| pixel.0[0] < 128));
        assert_eq!(std::fs::read_dir(&dir_tmp).unwrap().count(), 0);
    }

    #[test]
    fn un_pdf_roto_da_error_y_no_deja_temporales() {
        if !hay_pdftoppm() {
            eprintln!("pdftoppm no está instalado: se omite la prueba");
            return;
        }
        let tmp = Tmp::nuevo("pdf-roto");
        let pdf = tmp.0.join("roto.pdf");
        std::fs::write(&pdf, b"%PDF-1.4\nesto no es un pdf").unwrap();
        let dir_tmp = tmp.0.join("tmp");
        std::fs::create_dir_all(&dir_tmp).unwrap();

        assert!(miniatura_pdf(&pdf, &dir_tmp).is_err());
        assert_eq!(std::fs::read_dir(&dir_tmp).unwrap().count(), 0);
    }

    #[test]
    fn la_miniatura_de_un_pdf_se_guarda_en_la_cache_con_permisos_600() {
        use std::os::unix::fs::PermissionsExt;

        if !hay_pdftoppm() {
            eprintln!("pdftoppm no está instalado: se omite la prueba");
            return;
        }
        let tmp = Tmp::nuevo("pdf-cache");
        let origen = tmp.0.join("manual.pdf");
        std::fs::write(&origen, pdf_minimo()).unwrap();
        let base = tmp.0.join("cache");

        let destino = miniatura_en(&base, &origen).unwrap();

        assert!(destino.starts_with(bucket_en(&base, "large")));
        let mini = image::open(&destino).unwrap();
        assert!(mini.width() <= LADO && mini.height() <= LADO);
        assert_eq!(mtime_de_png(&destino), mtime_segundos(&origen));
        assert_eq!(
            std::fs::metadata(&destino).unwrap().permissions().mode() & 0o777,
            0o600
        );
        // El PNG temporal de `pdftoppm` no queda en el bucket.
        let pngs = std::fs::read_dir(bucket_en(&base, "large"))
            .unwrap()
            .count();
        assert_eq!(pngs, 1);
    }
}
