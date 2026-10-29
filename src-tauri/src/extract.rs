use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

fn get_stem_and_ext(path: &Path) -> (String, String) {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    if file_name.ends_with(".tar.gz") || file_name.ends_with(".tgz") {
        let stem = file_name
            .strip_suffix(".tar.gz")
            .or_else(|| file_name.strip_suffix(".tgz"))
            .unwrap_or(&file_name);
        return (stem.to_string(), "tgz".to_string());
    }
    if file_name.ends_with(".tar.bz2") || file_name.ends_with(".tbz2") {
        let stem = file_name
            .strip_suffix(".tar.bz2")
            .or_else(|| file_name.strip_suffix(".tbz2"))
            .unwrap_or(&file_name);
        return (stem.to_string(), "tbz2".to_string());
    }
    if file_name.ends_with(".tar.xz") || file_name.ends_with(".txz") {
        let stem = file_name
            .strip_suffix(".tar.xz")
            .or_else(|| file_name.strip_suffix(".txz"))
            .unwrap_or(&file_name);
        return (stem.to_string(), "txz".to_string());
    }
    if file_name.ends_with(".tar.zst") || file_name.ends_with(".tzst") {
        let stem = file_name
            .strip_suffix(".tar.zst")
            .or_else(|| file_name.strip_suffix(".tzst"))
            .unwrap_or(&file_name);
        return (stem.to_string(), "tzst".to_string());
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    (stem, ext)
}

/// Centinela: el archivo está cifrado y no se trajo clave. El frontend lo
/// reconoce y pide la contraseña.
const ENCRYPTED: &str = "ENCRYPTED";

/// Centinela: se trajo una clave pero es incorrecta.
const WRONG_PASSWORD: &str = "WRONG_PASSWORD";

/// Mapea el stderr de 7z/unzip a los centinelas de cifrado. `had_password`
/// separa «falta la clave» (ENCRYPTED) de «la clave es incorrecta»
/// (WRONG_PASSWORD). Devuelve `None` si el error no es de cifrado.
pub(crate) fn classify_crypto_error(stderr: &str, had_password: bool) -> Option<&'static str> {
    let lower = stderr.to_lowercase();

    let is_crypto = lower.contains("wrong password")
        || lower.contains("incorrect password")
        || lower.contains("enter password")
        || lower.contains("cannot open encrypted archive")
        || lower.contains("unable to get password");

    if !is_crypto {
        return None;
    }

    Some(if had_password {
        WRONG_PASSWORD
    } else {
        ENCRYPTED
    })
}

/// Una ruta por línea, descartando vacías: sirve para `zipinfo -1`, `tar -tf`,
/// `unrar lb` y `cpio -t`.
pub(crate) fn parse_plain_list(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(String::from)
        .collect()
}

/// Nombres de la salida de `7z l -ba -slt`: las líneas `Path = <nombre>`.
pub(crate) fn parse_7z_slt(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|line| line.strip_prefix("Path = "))
        .map(String::from)
        .collect()
}

/// Extrae con 7z pasando la clave por stdin (nunca en argv). Se omite `-p` a
/// propósito: con `-p` vacío 7z asume clave vacía y ni pregunta; sin `-p` lee la
/// clave de stdin. Sin clave, stdin nulo hace que falle rápido en vez de esperar
/// una terminal. Devuelve los centinelas de cifrado cuando corresponde.
fn extract_with_7z(archive_path: &str, dest: &Path, password: Option<&str>) -> Result<(), String> {
    let mut command = Command::new("7z");
    command
        .arg("x")
        .arg(archive_path)
        .arg(format!("-o{}", dest.display()))
        .arg("-y")
        .stdin(if password.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to run 7z: {}. Is 7zip installed?", e))?;

    if let Some(pass) = password {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(pass.as_bytes());
            let _ = stdin.write_all(b"\n");
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed while waiting for 7z: {}", e))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);

    if let Some(sentinel) = classify_crypto_error(&stderr, password.is_some()) {
        return Err(sentinel.to_string());
    }

    Err(format!("7z failed: {}", stderr))
}

#[tauri::command]
pub fn extract_archive(
    archive_path: String,
    dest_dir: String,
    password: Option<String>,
) -> Result<String, String> {
    let path = Path::new(&archive_path);
    if !path.exists() {
        return Err(format!("Archive not found: {}", archive_path));
    }

    let (_stem, ext) = get_stem_and_ext(path);
    let dest = Path::new(&dest_dir);

    // Clave vacía es como no traer clave.
    let password = password.filter(|value| !value.is_empty());

    match ext.as_str() {
        "zip" => {
            if let Some(pass) = password.as_deref() {
                // unzip sólo toma la clave por `-P` (en argv, prohibido), así que
                // los zip cifrados se extraen con 7z, que sí la lee por stdin.
                extract_with_7z(&archive_path, dest, Some(pass))?;
            } else {
                let output = Command::new("unzip")
                    .arg("-o")
                    .arg(&archive_path)
                    .arg("-d")
                    .arg(dest)
                    .stdin(Stdio::null())
                    .output()
                    .map_err(|e| format!("Failed to run unzip: {}. Is unzip installed?", e))?;
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if let Some(sentinel) = classify_crypto_error(&stderr, false) {
                        return Err(sentinel.to_string());
                    }
                    return Err(format!("unzip failed: {}", stderr));
                }
            }
        }
        "tgz" => {
            let output = Command::new("tar")
                .arg("-xzf")
                .arg(&archive_path)
                .arg("-C")
                .arg(dest)
                .output()
                .map_err(|e| format!("Failed to run tar: {}. Is tar installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("tar failed: {}", stderr));
            }
        }
        "tbz2" => {
            let output = Command::new("tar")
                .arg("-xjf")
                .arg(&archive_path)
                .arg("-C")
                .arg(dest)
                .output()
                .map_err(|e| format!("Failed to run tar: {}. Is tar installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("tar failed: {}", stderr));
            }
        }
        "txz" => {
            let output = Command::new("tar")
                .arg("-xJf")
                .arg(&archive_path)
                .arg("-C")
                .arg(dest)
                .output()
                .map_err(|e| format!("Failed to run tar: {}. Is tar installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("tar failed: {}", stderr));
            }
        }
        "tar" => {
            let output = Command::new("tar")
                .arg("-xf")
                .arg(&archive_path)
                .arg("-C")
                .arg(dest)
                .output()
                .map_err(|e| format!("Failed to run tar: {}. Is tar installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("tar failed: {}", stderr));
            }
        }
        "tzst" => {
            let output = Command::new("tar")
                .arg("--zstd")
                .arg("-xf")
                .arg(&archive_path)
                .arg("-C")
                .arg(dest)
                .output()
                .map_err(|e| format!("Failed to run tar: {}. Is zstd installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("tar failed: {}", stderr));
            }
        }
        "gz" | "gzip" => {
            let output = Command::new("gunzip")
                .arg("-c")
                .arg(&archive_path)
                .output()
                .map_err(|e| format!("Failed to run gunzip: {}. Is gzip installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("gunzip failed: {}", stderr));
            }
            let out_path = dest.join(&_stem);
            std::fs::write(&out_path, &output.stdout)
                .map_err(|e| format!("Failed to write decompressed file: {}", e))?;
        }
        "bz2" | "bzip2" => {
            let output = Command::new("bunzip2")
                .arg("-c")
                .arg(&archive_path)
                .output()
                .map_err(|e| format!("Failed to run bunzip2: {}. Is bzip2 installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("bunzip2 failed: {}", stderr));
            }
            let out_path = dest.join(&_stem);
            std::fs::write(&out_path, &output.stdout)
                .map_err(|e| format!("Failed to write decompressed file: {}", e))?;
        }
        "xz" => {
            let output = Command::new("unxz")
                .arg("-c")
                .arg(&archive_path)
                .output()
                .map_err(|e| format!("Failed to run unxz: {}. Is xz-utils installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("unxz failed: {}", stderr));
            }
            let out_path = dest.join(&_stem);
            std::fs::write(&out_path, &output.stdout)
                .map_err(|e| format!("Failed to write decompressed file: {}", e))?;
        }
        "7z" => {
            extract_with_7z(&archive_path, dest, password.as_deref())?;
        }
        "cpio" => {
            // Se extrae con `bsdtar` (libarchive), NO con GNU cpio: cpio honra las
            // rutas absolutas y los `..` por omisión —sin flag que lo cierre del
            // todo—, así que un `.cpio` malicioso escribiría FUERA del destino
            // (`~/.bashrc`, autostart…) → escritura arbitraria. bsdtar sanitiza los
            // `..` y las rutas absolutas por omisión, igual que ya hace con tar/zip.
            // `-f` y stdin nulo: lee el archivo por ruta, no espera nada del TTY.
            let output = Command::new("bsdtar")
                .arg("-x")
                .arg("-f")
                .arg(&archive_path)
                .arg("-C")
                .arg(dest)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .map_err(|e| format!("Failed to run bsdtar: {}. Is libarchive installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("bsdtar failed: {}", stderr));
            }
        }
        "rar" => {
            // unrar only treats the last argument as a target directory when it
            // ends with a separator; without it the path is used as a prefix.
            let dest_arg = format!("{}/", dest.to_string_lossy().trim_end_matches('/'));
            let output = Command::new("unrar")
                .arg("x")
                .arg("-y")
                .arg(&archive_path)
                .arg(&dest_arg)
                .output()
                .map_err(|e| format!("Failed to run unrar: {}. Is unrar installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("unrar failed: {}", stderr));
            }
        }
        _ => return Err(format!("Unsupported archive format: .{}", ext)),
    }

    Ok(format!("Extracted {} to {}", archive_path, dest_dir))
}

/// Lista los nombres de un programa que escribe «una ruta por línea» en stdout
/// (zipinfo, tar, unrar). stdin nulo para no quedar esperando una terminal.
fn list_plain(program: &str, args: &[&str]) -> Result<Vec<String>, String> {
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Failed to run {}: {}", program, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{} failed: {}", program, stderr));
    }

    Ok(parse_plain_list(&String::from_utf8_lossy(&output.stdout)))
}

/// Lista un cpio, que recibe el archivo por stdin.
fn list_cpio(archive_path: &str) -> Result<Vec<String>, String> {
    let file =
        std::fs::File::open(archive_path).map_err(|e| format!("Failed to open archive: {}", e))?;

    let child = Command::new("cpio")
        .arg("-t")
        .stdin(Stdio::from(file))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run cpio: {}. Is cpio installed?", e))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed while waiting for cpio: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("cpio failed: {}", stderr));
    }

    Ok(parse_plain_list(&String::from_utf8_lossy(&output.stdout)))
}

/// Lista un 7z. Se omite `-p` igual que al extraer: sin él 7z lee la clave de
/// stdin, con él la asume vacía. Devuelve los centinelas de cifrado cuando la
/// clave falta o es incorrecta.
fn list_7z(archive_path: &str, password: Option<&str>) -> Result<Vec<String>, String> {
    let mut command = Command::new("7z");
    command
        .args(["l", "-ba", "-slt", archive_path])
        .stdin(if password.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to run 7z: {}. Is 7zip installed?", e))?;

    if let Some(pass) = password {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(pass.as_bytes());
            let _ = stdin.write_all(b"\n");
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed while waiting for 7z: {}", e))?;

    if output.status.success() {
        return Ok(parse_7z_slt(&String::from_utf8_lossy(&output.stdout)));
    }

    let stderr = String::from_utf8_lossy(&output.stderr);

    if let Some(sentinel) = classify_crypto_error(&stderr, password.is_some()) {
        return Err(sentinel.to_string());
    }

    Err(format!("7z failed: {}", stderr))
}

/// Devuelve los nombres contenidos en el archivo, sin extraerlo. Para formatos
/// cifrados se pasa la clave por stdin; si falta o es incorrecta se devuelven
/// los centinelas ENCRYPTED / WRONG_PASSWORD.
#[tauri::command]
pub fn list_archive(archive_path: String, password: Option<String>) -> Result<Vec<String>, String> {
    let path = Path::new(&archive_path);
    if !path.exists() {
        return Err(format!("Archive not found: {}", archive_path));
    }

    let password = password.filter(|value| !value.is_empty());
    let (_stem, ext) = get_stem_and_ext(path);

    match ext.as_str() {
        // zipinfo lista los nombres sin clave: en zip no se cifran los nombres.
        "zip" => list_plain("zipinfo", &["-1", &archive_path]),
        // tar autodetecta gz/bz2/xz al listar; zst necesita --zstd.
        "tgz" | "tbz2" | "txz" | "tar" => list_plain("tar", &["-tf", &archive_path]),
        "tzst" => list_plain("tar", &["--zstd", "-tf", &archive_path]),
        "7z" => list_7z(&archive_path, password.as_deref()),
        "rar" => list_plain("unrar", &["lb", &archive_path]),
        "cpio" => list_cpio(&archive_path),
        _ => Err(format!("Unsupported archive format for listing: .{}", ext)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::polkit::testing::{cleanup, scratch};
    use std::path::PathBuf;

    fn texto(ruta: &Path) -> String {
        ruta.to_string_lossy().into_owned()
    }

    /// Arma a mano un `.cpio` en formato `newc` con los miembros dados, tal cual
    /// vienen (nombre y contenido): así se puede escribir un miembro con ruta
    /// absoluta o con `..`, cosa que `cpio -o` no se presta a hacer a gusto.
    /// El `mtime` queda en el futuro para que ni siquiera el «no pisar lo más
    /// nuevo» de GNU cpio frene una escritura que debería ser imposible.
    fn cpio_newc(miembros: &[(&str, &[u8])]) -> Vec<u8> {
        fn relleno(largo: usize) -> usize {
            (4 - largo % 4) % 4
        }

        fn cabecera(ino: u32, modo: u32, tamano: usize, nombre: usize) -> String {
            let campos = [
                ino,
                modo,
                0,
                0,
                1,
                0xFFFF_FF00,
                tamano as u32,
                0,
                0,
                0,
                0,
                nombre as u32,
                0,
            ];
            let cuerpo: String = campos.iter().map(|campo| format!("{campo:08X}")).collect();
            format!("070701{cuerpo}")
        }

        let mut salida = Vec::new();

        for (indice, (nombre, datos)) in miembros.iter().enumerate() {
            let nombre_nul = format!("{nombre}\0");
            salida.extend(
                cabecera(indice as u32 + 1, 0o100644, datos.len(), nombre_nul.len()).bytes(),
            );
            salida.extend(nombre_nul.bytes());
            salida.extend(std::iter::repeat_n(0u8, relleno(110 + nombre_nul.len())));
            salida.extend_from_slice(datos);
            salida.extend(std::iter::repeat_n(0u8, relleno(datos.len())));
        }

        let cola = "TRAILER!!!\0";
        salida.extend(cabecera(0, 0, 0, cola.len()).bytes());
        salida.extend(cola.bytes());
        salida.extend(std::iter::repeat_n(0u8, relleno(110 + cola.len())));
        salida
    }

    /// Toda ruta de archivo regular bajo `raiz`, relativa a ella y ordenada.
    fn archivos_bajo(raiz: &Path) -> Vec<String> {
        let mut rutas: Vec<String> = walkdir::WalkDir::new(raiz)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entrada| entrada.file_type().is_file())
            .map(|entrada| texto(entrada.path().strip_prefix(raiz).unwrap()))
            .collect();
        rutas.sort();
        rutas
    }

    /// Corre un programa y exige que termine bien: así una herramienta ausente
    /// rompe la prueba en vez de dejarla pasar sin probar nada.
    fn correr(programa: &str, args: &[&str], en: &Path) {
        let salida = Command::new(programa)
            .args(args)
            .current_dir(en)
            .stdin(Stdio::null())
            .output()
            .unwrap_or_else(|e| panic!("no se pudo correr {programa}: {e}"));
        assert!(
            salida.status.success(),
            "{programa} falló: {}",
            String::from_utf8_lossy(&salida.stderr)
        );
    }

    /// Un cpio con un miembro inofensivo y dos que intentan salirse, y las tres
    /// carpetas de la prueba: `base/destino` (adonde se extrae), `base/victima`
    /// (a donde apunta el miembro absoluto) y `base` (adonde apunta el `..`).
    struct Trampa {
        base: PathBuf,
        destino: PathBuf,
        victima: PathBuf,
        archivo: PathBuf,
    }

    fn trampa(nombre: &str) -> Trampa {
        let base = scratch(nombre);
        let destino = base.join("a").join("destino");
        let victima = base.join("victima");
        std::fs::create_dir_all(&destino).unwrap();
        std::fs::create_dir_all(&victima).unwrap();
        let ruta_absoluta = texto(&victima.join("absoluta.txt"));
        let archivo = base.join("malicioso.cpio");
        std::fs::write(
            &archivo,
            cpio_newc(&[
                ("inofensivo.txt", b"bien\n"),
                (&ruta_absoluta, b"PWNED\n"),
                ("../../escape.txt", b"PWNED\n"),
            ]),
        )
        .unwrap();
        Trampa {
            base,
            destino,
            victima,
            archivo,
        }
    }

    // --- Seguridad: un .cpio no escribe fuera del destino ---------------------

    #[test]
    fn un_cpio_con_ruta_absoluta_no_escribe_fuera_del_destino() {
        let t = trampa("cpio-ruta-absoluta");

        // El resultado puede ser Ok o Err según cómo trate la herramienta el `..`
        // del otro miembro: lo que importa es dónde terminó cada archivo.
        let _ = extract_archive(texto(&t.archivo), texto(&t.destino), None);

        assert!(
            !t.victima.join("absoluta.txt").exists(),
            "el miembro con ruta absoluta se escribió fuera del destino"
        );
        // Lo que sí hace es quedarse adentro, con la barra inicial recortada.
        assert!(
            archivos_bajo(&t.destino)
                .iter()
                .any(|ruta| ruta.ends_with("victima/absoluta.txt")),
            "el miembro absoluto debía quedar dentro del destino: {:?}",
            archivos_bajo(&t.destino)
        );
        cleanup(&t.base);
    }

    #[test]
    fn un_cpio_con_puntos_puntos_no_escribe_fuera_del_destino() {
        let t = trampa("cpio-puntos-puntos");

        let _ = extract_archive(texto(&t.archivo), texto(&t.destino), None);

        // `destino` está dos niveles bajo `base`: `../../escape.txt` cae en `base`.
        assert!(
            !t.base.join("escape.txt").exists(),
            "el miembro con `..` se escribió fuera del destino"
        );
        // Ni en ningún otro lado del árbol por fuera del destino.
        let fuera: Vec<String> = archivos_bajo(&t.base)
            .into_iter()
            .filter(|ruta| !ruta.starts_with("a/destino") && ruta != "malicioso.cpio")
            .collect();
        assert_eq!(fuera, Vec::<String>::new());
        cleanup(&t.base);
    }

    #[test]
    fn un_cpio_con_miembros_peligrosos_igual_extrae_el_inofensivo() {
        let t = trampa("cpio-inofensivo");

        let _ = extract_archive(texto(&t.archivo), texto(&t.destino), None);

        assert_eq!(
            std::fs::read_to_string(t.destino.join("inofensivo.txt")).unwrap(),
            "bien\n"
        );
        cleanup(&t.base);
    }

    #[test]
    fn un_cpio_normal_se_extrae_con_sus_carpetas() {
        let base = scratch("ext-cpio-normal");
        let destino = base.join("destino");
        std::fs::create_dir_all(&destino).unwrap();
        let archivo = base.join("normal.cpio");
        std::fs::write(
            &archivo,
            cpio_newc(&[("uno.txt", b"1\n"), ("sub/dos.txt", b"22\n")]),
        )
        .unwrap();

        let resultado = extract_archive(texto(&archivo), texto(&destino), None);

        assert!(resultado.is_ok(), "{resultado:?}");
        assert_eq!(archivos_bajo(&destino), vec!["sub/dos.txt", "uno.txt"]);
        assert_eq!(
            std::fs::read_to_string(destino.join("sub/dos.txt")).unwrap(),
            "22\n"
        );
        cleanup(&base);
    }

    #[test]
    fn un_cpio_corrupto_devuelve_el_error_de_bsdtar() {
        let base = scratch("ext-cpio-corrupto");
        let archivo = base.join("roto.cpio");
        std::fs::write(&archivo, b"esto no es un cpio, ni cerca").unwrap();

        let resultado = extract_archive(texto(&archivo), texto(&base), None);

        let error = resultado.unwrap_err();
        assert!(error.starts_with("bsdtar failed:"), "{error}");
        cleanup(&base);
    }

    // --- extract_archive: errores de entrada ---------------------------------

    #[test]
    fn extraer_un_archivo_que_no_existe_lo_dice() {
        let resultado = extract_archive("/no/existe/x.zip".into(), "/tmp".into(), None);

        assert_eq!(
            resultado.unwrap_err(),
            "Archive not found: /no/existe/x.zip"
        );
    }

    #[test]
    fn extraer_un_formato_desconocido_lo_rechaza() {
        let base = scratch("ext-formato-raro");
        let archivo = base.join("algo.xyz");
        std::fs::write(&archivo, b"x").unwrap();

        let resultado = extract_archive(texto(&archivo), texto(&base), None);

        assert_eq!(resultado.unwrap_err(), "Unsupported archive format: .xyz");
        cleanup(&base);
    }

    #[test]
    fn listar_un_archivo_que_no_existe_lo_dice() {
        let resultado = list_archive("/no/existe/x.zip".into(), None);

        assert_eq!(
            resultado.unwrap_err(),
            "Archive not found: /no/existe/x.zip"
        );
    }

    #[test]
    fn listar_un_formato_sin_soporte_lo_rechaza() {
        let base = scratch("ext-listar-formato-raro");
        let archivo = base.join("algo.xyz");
        std::fs::write(&archivo, b"x").unwrap();

        let resultado = list_archive(texto(&archivo), None);

        assert_eq!(
            resultado.unwrap_err(),
            "Unsupported archive format for listing: .xyz"
        );
        cleanup(&base);
    }

    // --- Extraer formatos nuevos y con clave -----------------------------------

    #[test]
    fn un_tar_zst_se_extrae_con_sus_contenidos() {
        let base = scratch("ext-extraer-tar-zst");
        let origen = base.join("origen");
        let destino = base.join("destino");
        std::fs::create_dir_all(origen.join("sub")).unwrap();
        std::fs::create_dir_all(&destino).unwrap();
        std::fs::write(origen.join("uno.txt"), "1").unwrap();
        std::fs::write(origen.join("sub/dos.txt"), "22").unwrap();
        correr(
            "tar",
            &["--zstd", "-cf", "../paquete.tar.zst", "uno.txt", "sub"],
            &origen,
        );

        let resultado =
            extract_archive(texto(&base.join("paquete.tar.zst")), texto(&destino), None);

        assert!(resultado.is_ok(), "{resultado:?}");
        assert_eq!(archivos_bajo(&destino), vec!["sub/dos.txt", "uno.txt"]);
        cleanup(&base);
    }

    #[test]
    fn un_tzst_se_extrae_igual_que_un_tar_zst() {
        let base = scratch("ext-extraer-tzst");
        let origen = base.join("origen");
        let destino = base.join("destino");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::create_dir_all(&destino).unwrap();
        std::fs::write(origen.join("uno.txt"), "1").unwrap();
        correr(
            "tar",
            &["--zstd", "-cf", "../paquete.tzst", "uno.txt"],
            &origen,
        );

        let resultado = extract_archive(texto(&base.join("paquete.tzst")), texto(&destino), None);

        assert!(resultado.is_ok(), "{resultado:?}");
        assert_eq!(archivos_bajo(&destino), vec!["uno.txt"]);
        cleanup(&base);
    }

    /// Un 7z cifrado (contenido y encabezados) creado con la misma receta que
    /// usa `compress_items`: la clave por stdin, nunca en argv.
    fn crear_7z_cifrado(base: &Path, clave: &str) -> PathBuf {
        let origen = base.join("origen");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::write(origen.join("secreto.txt"), "contenido secreto").unwrap();
        let mut hijo = Command::new("7z")
            .args(["a", "-mhe=on", "-p", "../cifrado.7z", "--", "secreto.txt"])
            .current_dir(&origen)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("7z instalado");
        hijo.stdin
            .take()
            .unwrap()
            .write_all(format!("{clave}\n").as_bytes())
            .unwrap();
        assert!(hijo.wait().unwrap().success());
        base.join("cifrado.7z")
    }

    #[test]
    fn un_7z_cifrado_sin_clave_pide_la_clave() {
        let base = scratch("ext-7z-sin-clave");
        let archivo = crear_7z_cifrado(&base, "clave");
        let destino = base.join("destino");
        std::fs::create_dir_all(&destino).unwrap();

        let resultado = extract_archive(texto(&archivo), texto(&destino), None);

        assert_eq!(resultado.unwrap_err(), "ENCRYPTED");
        assert_eq!(archivos_bajo(&destino), Vec::<String>::new());
        cleanup(&base);
    }

    #[test]
    fn una_clave_vacia_cuenta_como_no_traer_clave() {
        let base = scratch("ext-7z-clave-vacia");
        let archivo = crear_7z_cifrado(&base, "clave");

        let resultado = extract_archive(texto(&archivo), texto(&base), Some(String::new()));

        // Si la vacía se mandara como clave sería WRONG_PASSWORD.
        assert_eq!(resultado.unwrap_err(), "ENCRYPTED");
        cleanup(&base);
    }

    #[test]
    fn un_7z_cifrado_con_clave_incorrecta_lo_distingue() {
        let base = scratch("ext-7z-clave-mala");
        let archivo = crear_7z_cifrado(&base, "clave");
        let destino = base.join("destino");
        std::fs::create_dir_all(&destino).unwrap();

        let resultado = extract_archive(texto(&archivo), texto(&destino), Some("otra".into()));

        assert_eq!(resultado.unwrap_err(), "WRONG_PASSWORD");
        assert_eq!(archivos_bajo(&destino), Vec::<String>::new());
        cleanup(&base);
    }

    #[test]
    fn un_7z_cifrado_con_la_clave_correcta_se_extrae() {
        let base = scratch("ext-7z-clave-buena");
        let archivo = crear_7z_cifrado(&base, "clave");
        let destino = base.join("destino");
        std::fs::create_dir_all(&destino).unwrap();

        let resultado = extract_archive(texto(&archivo), texto(&destino), Some("clave".into()));

        assert!(resultado.is_ok(), "{resultado:?}");
        assert_eq!(
            std::fs::read_to_string(destino.join("secreto.txt")).unwrap(),
            "contenido secreto"
        );
        cleanup(&base);
    }

    #[test]
    fn un_zip_con_clave_se_extrae_con_7z() {
        let base = scratch("ext-zip-con-clave");
        let origen = base.join("origen");
        let destino = base.join("destino");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::create_dir_all(&destino).unwrap();
        std::fs::write(origen.join("secreto.txt"), "zip cifrado").unwrap();
        let mut hijo = Command::new("7z")
            .args([
                "a",
                "-tzip",
                "-mem=AES256",
                "-p",
                "../cifrado.zip",
                "--",
                "secreto.txt",
            ])
            .current_dir(&origen)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("7z instalado");
        hijo.stdin.take().unwrap().write_all(b"clave\n").unwrap();
        assert!(hijo.wait().unwrap().success());

        let mala = extract_archive(
            texto(&base.join("cifrado.zip")),
            texto(&destino),
            Some("otra".into()),
        );
        let buena = extract_archive(
            texto(&base.join("cifrado.zip")),
            texto(&destino),
            Some("clave".into()),
        );

        assert_eq!(mala.unwrap_err(), "WRONG_PASSWORD");
        assert!(buena.is_ok(), "{buena:?}");
        assert_eq!(
            std::fs::read_to_string(destino.join("secreto.txt")).unwrap(),
            "zip cifrado"
        );
        cleanup(&base);
    }

    // --- list_archive -------------------------------------------------------------

    #[test]
    fn listar_un_zip_devuelve_sus_nombres() {
        let base = scratch("ext-listar-zip");
        let origen = base.join("origen");
        std::fs::create_dir_all(origen.join("sub")).unwrap();
        std::fs::write(origen.join("uno.txt"), "1").unwrap();
        std::fs::write(origen.join("sub/dos.txt"), "2").unwrap();
        correr("zip", &["-qr", "../caja.zip", "uno.txt", "sub"], &origen);

        let mut nombres = list_archive(texto(&base.join("caja.zip")), None).unwrap();

        nombres.sort();
        assert_eq!(nombres, vec!["sub/", "sub/dos.txt", "uno.txt"]);
        cleanup(&base);
    }

    #[test]
    fn listar_un_tar_devuelve_sus_nombres() {
        let base = scratch("ext-listar-tar");
        let origen = base.join("origen");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::write(origen.join("uno.txt"), "1").unwrap();
        std::fs::write(origen.join("dos.txt"), "2").unwrap();
        correr(
            "tar",
            &["-cf", "../caja.tar", "uno.txt", "dos.txt"],
            &origen,
        );
        correr("tar", &["-czf", "../caja.tar.gz", "uno.txt"], &origen);

        let tar = list_archive(texto(&base.join("caja.tar")), None).unwrap();
        let tgz = list_archive(texto(&base.join("caja.tar.gz")), None).unwrap();

        assert_eq!(tar, vec!["uno.txt", "dos.txt"]);
        assert_eq!(tgz, vec!["uno.txt"]);
        cleanup(&base);
    }

    #[test]
    fn listar_un_tar_zst_devuelve_sus_nombres() {
        let base = scratch("ext-listar-tar-zst");
        let origen = base.join("origen");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::write(origen.join("uno.txt"), "1").unwrap();
        correr(
            "tar",
            &["--zstd", "-cf", "../caja.tar.zst", "uno.txt"],
            &origen,
        );

        let nombres = list_archive(texto(&base.join("caja.tar.zst")), None).unwrap();

        assert_eq!(nombres, vec!["uno.txt"]);
        cleanup(&base);
    }

    #[test]
    fn listar_un_cpio_devuelve_sus_nombres() {
        let base = scratch("ext-listar-cpio");
        let archivo = base.join("caja.cpio");
        std::fs::write(
            &archivo,
            cpio_newc(&[("uno.txt", b"1"), ("sub/dos.txt", b"2")]),
        )
        .unwrap();

        let nombres = list_archive(texto(&archivo), None).unwrap();

        assert_eq!(nombres, vec!["uno.txt", "sub/dos.txt"]);
        cleanup(&base);
    }

    #[test]
    fn listar_un_cpio_corrupto_devuelve_error() {
        let base = scratch("ext-listar-cpio-roto");
        let archivo = base.join("roto.cpio");
        std::fs::write(&archivo, b"basura").unwrap();

        let error = list_archive(texto(&archivo), None).unwrap_err();

        assert!(error.starts_with("cpio failed:"), "{error}");
        cleanup(&base);
    }

    #[test]
    fn listar_un_zip_roto_devuelve_el_error_de_la_herramienta() {
        let base = scratch("ext-listar-zip-roto");
        let archivo = base.join("roto.zip");
        std::fs::write(&archivo, b"no soy un zip").unwrap();

        let error = list_archive(texto(&archivo), None).unwrap_err();

        assert!(error.starts_with("zipinfo failed:"), "{error}");
        cleanup(&base);
    }

    #[test]
    fn listar_un_7z_cifrado_sin_clave_pide_la_clave() {
        let base = scratch("ext-listar-7z-sin-clave");
        let archivo = crear_7z_cifrado(&base, "clave");

        let resultado = list_archive(texto(&archivo), None);

        // Los nombres también van cifrados (`-mhe=on`): sin clave no hay lista.
        assert_eq!(resultado.unwrap_err(), "ENCRYPTED");
        cleanup(&base);
    }

    #[test]
    fn listar_un_7z_cifrado_con_clave_incorrecta_lo_distingue() {
        let base = scratch("ext-listar-7z-clave-mala");
        let archivo = crear_7z_cifrado(&base, "clave");

        let resultado = list_archive(texto(&archivo), Some("otra".into()));

        assert_eq!(resultado.unwrap_err(), "WRONG_PASSWORD");
        cleanup(&base);
    }

    #[test]
    fn listar_un_7z_cifrado_con_la_clave_correcta_devuelve_el_contenido() {
        let base = scratch("ext-listar-7z-clave-buena");
        let archivo = crear_7z_cifrado(&base, "clave");

        let nombres = list_archive(texto(&archivo), Some("clave".into())).unwrap();

        assert_eq!(nombres, vec!["secreto.txt"]);
        cleanup(&base);
    }

    #[test]
    fn listar_un_7z_sin_cifrar_no_necesita_clave() {
        let base = scratch("ext-listar-7z-abierto");
        let origen = base.join("origen");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::write(origen.join("abierto.txt"), "x").unwrap();
        correr(
            "7z",
            &["a", "-bd", "../abierto.7z", "--", "abierto.txt"],
            &origen,
        );

        let nombres = list_archive(texto(&base.join("abierto.7z")), Some(String::new())).unwrap();

        assert_eq!(nombres, vec!["abierto.txt"]);
        cleanup(&base);
    }

    // --- Helpers puros ---------------------------------------------------------------

    #[test]
    fn el_stem_y_la_extension_reconocen_tar_zst_y_tzst() {
        assert_eq!(
            get_stem_and_ext(Path::new("/x/datos.tar.zst")),
            ("datos".to_string(), "tzst".to_string())
        );
        assert_eq!(
            get_stem_and_ext(Path::new("/x/datos.tzst")),
            ("datos".to_string(), "tzst".to_string())
        );
        assert_eq!(
            get_stem_and_ext(Path::new("/x/caja.CPIO")),
            ("caja".to_string(), "cpio".to_string())
        );
    }

    #[test]
    fn la_clave_incorrecta_se_reconoce_con_o_sin_clave_previa() {
        for stderr in [
            "ERROR: Wrong password",
            "Cannot open encrypted archive. Wrong password?",
            "skipping: x  incorrect password",
        ] {
            assert_eq!(
                classify_crypto_error(stderr, true),
                Some("WRONG_PASSWORD"),
                "{stderr}"
            );
        }
    }

    #[test]
    fn sin_clave_previa_los_avisos_de_cifrado_piden_la_clave() {
        assert_eq!(
            classify_crypto_error("Enter password (will not be echoed):", false),
            Some("ENCRYPTED")
        );
        assert_eq!(
            classify_crypto_error("ERROR: a.7z : Cannot open encrypted archive.", false),
            Some("ENCRYPTED")
        );
        assert_eq!(
            classify_crypto_error("Unable to get password", false),
            Some("ENCRYPTED")
        );
        // «Wrong password» sin haber traído clave también es pedir la clave.
        assert_eq!(
            classify_crypto_error("Wrong password", false),
            Some("ENCRYPTED")
        );
    }

    #[test]
    fn con_clave_previa_un_aviso_de_cifrado_es_clave_incorrecta() {
        assert_eq!(
            classify_crypto_error("Enter password:", true),
            Some("WRONG_PASSWORD")
        );
        assert_eq!(
            classify_crypto_error("Cannot open encrypted archive", true),
            Some("WRONG_PASSWORD")
        );
    }

    #[test]
    fn la_clasificacion_no_distingue_mayusculas() {
        assert_eq!(
            classify_crypto_error("WRONG PASSWORD", true),
            Some("WRONG_PASSWORD")
        );
        assert_eq!(
            classify_crypto_error("ENTER PASSWORD", false),
            Some("ENCRYPTED")
        );
    }

    #[test]
    fn un_error_que_no_es_de_cifrado_no_se_clasifica() {
        assert_eq!(classify_crypto_error("", true), None);
        assert_eq!(
            classify_crypto_error("No such file or directory", false),
            None
        );
        assert_eq!(
            classify_crypto_error("Unexpected end of archive", true),
            None
        );
    }

    #[test]
    fn parse_plain_list_devuelve_una_ruta_por_linea_sin_vacias() {
        let salida = "uno.txt\nsub/\n\nsub/dos con espacios.txt\n\n";

        assert_eq!(
            parse_plain_list(salida),
            vec!["uno.txt", "sub/", "sub/dos con espacios.txt"]
        );
        assert_eq!(parse_plain_list(""), Vec::<String>::new());
    }

    #[test]
    fn parse_7z_slt_toma_solo_las_lineas_path() {
        let salida = "\
Path = uno.txt
Size = 3
Packed Size = 3
Modified = 2026-01-01 00:00:00

Path = sub/dos.txt
Size = 4
Attributes = A -rw-r--r--
Comment = Path = esto no es un nombre
";

        assert_eq!(parse_7z_slt(salida), vec!["uno.txt", "sub/dos.txt"]);
        assert_eq!(parse_7z_slt(""), Vec::<String>::new());
    }

    // --- Formatos de un solo archivo y archivos rotos --------------------------------

    #[test]
    fn un_gz_un_bz2_y_un_xz_sueltos_se_extraen_con_su_nombre_sin_extension() {
        let base = scratch("ext-comprimidos-sueltos");
        let origen = base.join("origen");
        std::fs::create_dir_all(&origen).unwrap();

        for (programa, extension) in [("gzip", "gz"), ("bzip2", "bz2"), ("xz", "xz")] {
            let nombre = format!("nota-{extension}.txt");
            std::fs::write(origen.join(&nombre), format!("contenido {extension}")).unwrap();
            correr(programa, &["-k", &nombre], &origen);
            let destino = base.join(format!("destino-{extension}"));
            std::fs::create_dir_all(&destino).unwrap();

            let resultado = extract_archive(
                texto(&origen.join(format!("{nombre}.{extension}"))),
                texto(&destino),
                None,
            );

            assert!(resultado.is_ok(), "{extension}: {resultado:?}");
            assert_eq!(
                std::fs::read_to_string(destino.join(&nombre)).unwrap(),
                format!("contenido {extension}"),
                "{extension}"
            );
        }
        cleanup(&base);
    }

    #[test]
    fn un_archivo_roto_de_cada_formato_devuelve_el_error_de_su_herramienta() {
        let base = scratch("ext-rotos");
        let destino = base.join("destino");
        std::fs::create_dir_all(&destino).unwrap();

        for (extension, herramienta) in [
            ("zip", "unzip failed:"),
            ("tar", "tar failed:"),
            ("tar.gz", "tar failed:"),
            ("tar.bz2", "tar failed:"),
            ("tar.xz", "tar failed:"),
            ("tar.zst", "tar failed:"),
            ("gz", "gunzip failed:"),
            ("bz2", "bunzip2 failed:"),
            ("xz", "unxz failed:"),
            ("7z", "7z failed:"),
            ("rar", "unrar failed:"),
        ] {
            let archivo = base.join(format!("roto.{extension}"));
            std::fs::write(&archivo, b"esto no es un archivo comprimido, ni de cerca").unwrap();

            let error = extract_archive(texto(&archivo), texto(&destino), None).unwrap_err();

            assert!(error.starts_with(herramienta), "{extension}: {error}");
        }
        assert_eq!(archivos_bajo(&destino), Vec::<String>::new());
        cleanup(&base);
    }

    #[test]
    fn listar_un_7z_roto_devuelve_el_error_de_la_herramienta() {
        let base = scratch("ext-listar-7z-roto");
        let archivo = base.join("roto.7z");
        std::fs::write(&archivo, b"no soy un 7z").unwrap();

        let error = list_archive(texto(&archivo), None).unwrap_err();

        assert!(error.starts_with("7z failed:"), "{error}");
        cleanup(&base);
    }
}
