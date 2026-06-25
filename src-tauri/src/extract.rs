use std::path::Path;
use std::process::Command;

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

#[tauri::command]
pub fn extract_archive(archive_path: String, dest_dir: String) -> Result<String, String> {
    let path = Path::new(&archive_path);
    if !path.exists() {
        return Err(format!("Archive not found: {}", archive_path));
    }

    let (_stem, ext) = get_stem_and_ext(path);
    let dest = Path::new(&dest_dir);

    match ext.as_str() {
        "zip" => {
            let output = Command::new("unzip")
                .arg("-o")
                .arg(&archive_path)
                .arg("-d")
                .arg(dest)
                .output()
                .map_err(|e| format!("Failed to run unzip: {}. Is unzip installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("unzip failed: {}", stderr));
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
            let output = Command::new("7z")
                .arg("x")
                .arg(&archive_path)
                .arg(format!("-o{}", dest.display()))
                .arg("-y")
                .output()
                .map_err(|e| format!("Failed to run 7z: {}. Is p7zip installed?", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("7z failed: {}", stderr));
            }
        }
        "rar" => {
            let output = Command::new("unrar")
                .arg("x")
                .arg("-y")
                .arg(&archive_path)
                .arg(dest.to_str().unwrap_or(""))
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
