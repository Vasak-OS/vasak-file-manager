use std::fs;
use std::io::Read;

const MAX_PREVIEW_SIZE: u64 = 100 * 1024;

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read file metadata: {e}"))?;

    if !metadata.is_file() {
        return Err("Not a file".into());
    }

    let file_size = metadata.len();
    let mut file = fs::File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;

    let read_size = std::cmp::min(file_size, MAX_PREVIEW_SIZE);
    let mut buffer = vec![0u8; read_size as usize];
    file.read_exact(&mut buffer)
        .map_err(|e| format!("Failed to read file: {e}"))?;

    let content = String::from_utf8(buffer)
        .map_err(|e| format!("File is not valid UTF-8 text: {e}"))?;

    let is_truncated = file_size > MAX_PREVIEW_SIZE;

    Ok(if is_truncated {
        format!("{content}\n\n... (file truncated, showing first 100 KB)")
    } else {
        content
    })
}

#[tauri::command]
pub fn read_pdf_preview(path: String) -> Result<String, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read file metadata: {e}"))?;
    if !metadata.is_file() {
        return Err("Not a file".into());
    }

    let tmp_dir = std::env::temp_dir();
    let tmp_prefix = format!("vsk-pdf-{}", std::process::id());
    let tmp_output = tmp_dir.join(tmp_prefix);

    let status = std::process::Command::new("pdftoppm")
        .args(["-f", "1", "-l", "1", "-png", "-scale-to", "800"])
        .arg(&path)
        .arg(&tmp_output)
        .status()
        .map_err(|e| format!("Failed to run pdftoppm: {e}"))?;

    if !status.success() {
        return Err("pdftoppm failed to process the PDF".into());
    }

    let result_file = format!("{}-1.png", tmp_output.display());
    let data = fs::read(&result_file).map_err(|e| format!("Failed to read pdftoppm output: {e}"))?;

    let _ = fs::remove_file(&result_file);

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}
