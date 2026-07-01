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
            Err(format!("{}", stderr.trim()))
        }
    }
}

pub fn copy_with_pkexec(src: &Path, dest: &Path) -> Result<(), String> {
    run_with_pkexec(&["cp", "-r", &src.to_string_lossy(), &dest.to_string_lossy()])
}

pub fn move_with_pkexec(src: &Path, dest: &Path) -> Result<(), String> {
    run_with_pkexec(&["mv", &src.to_string_lossy(), &dest.to_string_lossy()])
}

pub fn remove_with_pkexec(path: &Path) -> Result<(), String> {
    run_with_pkexec(&["rm", "-rf", &path.to_string_lossy()])
}

pub fn create_dir_with_pkexec(path: &Path) -> Result<(), String> {
    run_with_pkexec(&["mkdir", "-p", &path.to_string_lossy()])
}

pub fn create_file_with_pkexec(path: &Path) -> Result<(), String> {
    run_with_pkexec(&["touch", &path.to_string_lossy()])
}

pub fn rename_with_pkexec(src: &Path, dest: &Path) -> Result<(), String> {
    run_with_pkexec(&["mv", &src.to_string_lossy(), &dest.to_string_lossy()])
}

pub fn is_permission_denied(error: &str) -> bool {
    error.contains("Permission denied")
        || error.contains("Acceso denegado")
        || error.contains("Operation not permitted")
        || error.contains("Operación no permitida")
}
