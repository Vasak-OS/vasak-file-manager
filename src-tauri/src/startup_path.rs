//! La carpeta con la que abrir, cuando alguien la pasa por parámetro.
//!
//! El «abrir carpeta contenedora» de Chrome, el «mostrar en el gestor de
//! archivos» de cualquier descarga y el `xdg-open` de un directorio terminan
//! todos en lo mismo: ejecutar el gestor con una ruta. El `.desktop` ya la
//! pasaba —declara `Exec` con `%U` y el tipo `inode/directory`— pero el
//! programa no miraba sus argumentos, así que abría el home y quien había
//! pedido ver una descarga tenía que ir a buscarla a mano.
//!
//! Lo que llega no siempre es una ruta: con `%U` el sistema entrega un URI, y
//! si el nombre tiene espacios viene escapado. Y muchas veces apunta al
//! archivo, no a la carpeta —«mostrar este archivo» es justamente eso—, así que
//! lo que se abre es el directorio que lo contiene.

use std::path::{Path, PathBuf};

/// La ruta pedida, ya resuelta a un directorio que existe.
///
/// `None` significa «nadie pidió nada» o «lo que pidió no está», y en los dos
/// casos el programa sigue con su comportamiento normal: es mejor abrir el home
/// que no abrir nada.
pub fn from_args<I: Iterator<Item = String>>(args: I) -> Option<PathBuf> {
    args.skip(1)
        .filter(|argument| !argument.starts_with('-'))
        .find_map(|argument| resolve(&argument))
}

/// Convierte un argumento en el directorio que hay que mostrar.
pub fn resolve(argument: &str) -> Option<PathBuf> {
    let path = to_path(argument)?;

    if path.is_dir() {
        return Some(path);
    }

    // Un archivo: se muestra la carpeta donde vive. Si además existiera, el
    // frontend puede seleccionarlo; lo que no puede es listar un archivo.
    if path.is_file() {
        return path.parent().map(Path::to_path_buf);
    }

    None
}

/// Un argumento puede venir como ruta o como URI.
fn to_path(argument: &str) -> Option<PathBuf> {
    if let Some(rest) = argument.strip_prefix("file://") {
        // file:///home/… trae el host vacío; con host (file://equipo/…) no es
        // algo que podamos abrir localmente.
        let rest = rest.strip_prefix('/')?;
        return Some(PathBuf::from(format!("/{}", percent_decode(rest))));
    }

    if argument.contains("://") {
        return None;
    }

    Some(PathBuf::from(argument))
}

/// Deshace el escapado de los URI, que es lo que convierte «Mi carpeta» en
/// «Mi%20carpeta».
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(value) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }

    // Un nombre de archivo no tiene por qué ser UTF-8 válido, pero lo que sigue
    // sí necesita texto; lossy conserva todo lo legible en vez de descartar la
    // ruta entera.
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
pub fn startup_path() -> Option<String> {
    from_args(std::env::args()).map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporal(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vasak-fm-{nombre}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn una_carpeta_se_abre_tal_cual() {
        let dir = temporal("carpeta");
        assert_eq!(resolve(dir.to_str().unwrap()), Some(dir));
    }

    /// «Mostrar en el gestor de archivos» apunta al archivo descargado, no a la
    /// carpeta: lo que hay que abrir es dónde está.
    #[test]
    fn un_archivo_abre_la_carpeta_que_lo_contiene() {
        let dir = temporal("con-archivo");
        let archivo = dir.join("descarga.zip");
        std::fs::write(&archivo, b"").unwrap();
        assert_eq!(resolve(archivo.to_str().unwrap()), Some(dir));
    }

    /// Con %U el sistema entrega un URI, y los espacios vienen escapados.
    #[test]
    fn acepta_uris_con_nombres_escapados() {
        let dir = temporal("mis cosas");
        let uri = format!("file://{}", dir.to_str().unwrap().replace(' ', "%20"));
        assert_eq!(resolve(&uri), Some(dir));
    }

    /// Lo que no existe no se abre, y lo que no es local tampoco: en los dos
    /// casos el programa sigue como si no le hubieran pasado nada.
    #[test]
    fn lo_que_no_se_puede_abrir_no_inventa_una_ruta() {
        assert_eq!(resolve("/no/existe/esta/carpeta"), None);
        assert_eq!(resolve("https://vasak.net.ar"), None);
        assert_eq!(resolve("file://equipo-remoto/compartido"), None);
    }

    /// Las banderas no son rutas, y el primer argumento es el programa.
    #[test]
    fn ignora_el_programa_y_las_banderas() {
        let dir = temporal("desde-argv");
        let args = vec![
            "vasak-file-manager".to_string(),
            "--algo".to_string(),
            dir.to_str().unwrap().to_string(),
        ];
        assert_eq!(from_args(args.into_iter()), Some(dir));

        let solo_programa = vec!["vasak-file-manager".to_string()];
        assert_eq!(from_args(solo_programa.into_iter()), None);
    }
}
