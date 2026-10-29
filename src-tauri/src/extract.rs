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
