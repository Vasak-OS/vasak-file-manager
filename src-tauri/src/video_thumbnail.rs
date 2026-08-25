//! Miniaturas de video, hechas por ffmpeg y guardadas en disco.
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
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))?;
    let dir = base.join("thumbnails").join("vasak-video");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
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

    if destino.is_file() {
        return Ok(destino);
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
    let parcial = destino.with_extension(format!(
        "parcial-{}-{nonce}.jpg",
        std::process::id()
    ));

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
}
