use log::info;
use std::path::Path;
use std::process::Command;

fn pkexec_available() -> bool {
    Path::new("/usr/bin/pkexec").exists()
}

fn run_with_pkexec(args: &[&str]) -> Result<(), String> {
    if !pkexec_available() {
        return Err("pkexec not available. Install polkit.".into());
    }
    info!("Elevating privileges: pkexec {}", args.join(" "));
    let output = Command::new("pkexec")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute pkexec: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let exit_code = output.status.code().unwrap_or(-1);
        if exit_code == 127 {
            Err("Authentication cancelled or polkit denied.".into())
        } else {
            Err(stderr.trim().to_string())
        }
    }
}

pub fn copy_with_pkexec(src: &Path, dest: &Path) -> Result<(), String> {
    run_with_pkexec(&[
        "cp",
        "-r",
        "--",
        &src.to_string_lossy(),
        &dest.to_string_lossy(),
    ])
}

pub fn move_with_pkexec(src: &Path, dest: &Path) -> Result<(), String> {
    run_with_pkexec(&["mv", "--", &src.to_string_lossy(), &dest.to_string_lossy()])
}

pub fn remove_with_pkexec(path: &Path) -> Result<(), String> {
    run_with_pkexec(&["rm", "-rf", "--", &path.to_string_lossy()])
}

pub fn create_dir_with_pkexec(path: &Path) -> Result<(), String> {
    run_with_pkexec(&["mkdir", "-p", "--", &path.to_string_lossy()])
}

pub fn create_file_with_pkexec(path: &Path) -> Result<(), String> {
    run_with_pkexec(&["touch", "--", &path.to_string_lossy()])
}

pub fn rename_with_pkexec(src: &Path, dest: &Path) -> Result<(), String> {
    run_with_pkexec(&["mv", "--", &src.to_string_lossy(), &dest.to_string_lossy()])
}

/// Por el código y no sólo por el texto: GTK pone el proceso en el idioma de la
/// persona, y en castellano glibc dice «Permiso denegado», que no estaba en la
/// lista —no se pedía la contraseña nunca—. Rust agrega `(os error N)` en
/// cualquier idioma: 13 es `EACCES` y 1 es `EPERM`.
pub fn is_permission_denied(error: &str) -> bool {
    error.contains("(os error 13)")
        || error.contains("(os error 1)")
        || error.contains("Permiso denegado")
        || error.contains("Permission denied")
        || error.contains("Acceso denegado")
        || error.contains("Operation not permitted")
        || error.contains("Operación no permitida")
}

#[cfg(test)]
mod tests {
    use super::is_permission_denied;

    #[test]
    fn el_mensaje_en_castellano_de_permiso_denegado_se_detecta() {
        assert!(is_permission_denied("Permiso denegado (os error 13)"));
        assert!(is_permission_denied("Permiso denegado"));
    }

    #[test]
    fn el_codigo_13_se_detecta_aunque_el_texto_este_en_otro_idioma() {
        assert!(is_permission_denied("Zugriff verweigert (os error 13)"));
    }

    #[test]
    fn el_error_de_operacion_no_permitida_por_codigo_se_detecta() {
        let error = std::io::Error::from_raw_os_error(1).to_string();
        assert!(error.contains("(os error 1)"));
        assert!(is_permission_denied(&error));
        assert!(is_permission_denied("Operação não permitida (os error 1)"));
    }

    #[test]
    fn el_error_de_permiso_del_sistema_se_detecta_sea_cual_sea_el_idioma() {
        let error = std::io::Error::from_raw_os_error(13).to_string();
        assert!(is_permission_denied(&error));
    }

    #[test]
    fn los_errores_ajenos_a_los_permisos_no_piden_contrasena() {
        assert!(!is_permission_denied(
            "No such file or directory (os error 2)"
        ));
        assert!(!is_permission_denied(
            "No existe el archivo o el directorio (os error 2)"
        ));
        assert!(!is_permission_denied(
            "Cannot allocate memory (os error 12)"
        ));
        assert!(!is_permission_denied("No child processes (os error 10)"));
        assert!(!is_permission_denied("File exists (os error 17)"));
    }
}
