use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::polkit;
use crate::undo;
use crate::undo::now_secs;
use crate::utils::normalize_path;

// Cancellation tokens for in-flight file operations, keyed by an operation id
// the frontend supplies (same idea as dir_size's ACTIVE_CALCULATIONS).
static ACTIVE_OPERATIONS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub(crate) fn register_operation(id: &str) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = ACTIVE_OPERATIONS.lock() {
        map.insert(id.to_string(), token.clone());
    }
    token
}

pub(crate) fn unregister_operation(id: &str) {
    if let Ok(mut map) = ACTIVE_OPERATIONS.lock() {
        map.remove(id);
    }
}

pub(crate) fn is_cancelled(token: &Option<Arc<AtomicBool>>) -> bool {
    token.as_ref().is_some_and(|t| t.load(Ordering::SeqCst))
}

/// Request cancellation of an in-flight copy/move/delete by operation id.
#[tauri::command]
pub fn cancel_file_operation(operation_id: String) -> bool {
    if let Ok(map) = ACTIVE_OPERATIONS.lock() {
        if let Some(token) = map.get(&operation_id) {
            token.store(true, Ordering::SeqCst);
            return true;
        }
    }
    false
}

#[derive(Serialize, Clone)]
struct OperationProgress {
    operation_id: String,
    kind: String,
    processed: usize,
    total: usize,
    current: String,
}

pub(crate) fn emit_progress(app: &AppHandle, id: &Option<String>, kind: &str, processed: usize, total: usize, current: &str) {
    if let Some(id) = id {
        let _ = app.emit(
            "file-operation-progress",
            OperationProgress {
                operation_id: id.clone(),
                kind: kind.to_string(),
                processed,
                total,
                current: current.to_string(),
            },
        );
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileOperationResult {
    pub success: bool,
    pub error: Option<String>,
    pub copied_count: Option<u32>,
    pub failed_count: Option<u32>,
    pub skipped_count: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConflictItem {
    pub source_path: String,
    pub source_name: String,
    pub source_is_dir: bool,
    pub source_size: Option<u64>,
    pub destination_path: String,
    pub destination_is_dir: bool,
    pub destination_size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConflictResolution {
    Replace,
    Skip,
    AutoRename,
}

impl ConflictResolution {
    fn from_str(value: &str) -> Self {
        match value {
            "replace" => ConflictResolution::Replace,
            "skip" => ConflictResolution::Skip,
            "auto-rename" => ConflictResolution::AutoRename,
            _ => ConflictResolution::AutoRename,
        }
    }
}

fn copy_dir_recursive(
    source: &Path,
    destination: &Path,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    if !destination.exists() {
        if let Err(error) = fs::create_dir_all(destination) {
            if polkit::is_permission_denied(&error.to_string()) {
                polkit::create_dir_with_pkexec(destination)?;
            } else {
                return Err(error.to_string());
            }
        }
    }

    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        if cancel.is_some_and(|t| t.load(Ordering::SeqCst)) {
            return Err("Operation cancelled".to_string());
        }
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let file_name = source_path.file_name().ok_or("Invalid file name")?;
        let dest_path = destination.join(file_name);

        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &dest_path, cancel)?;
        } else if let Err(error) = fs::copy(&source_path, &dest_path) {
            if polkit::is_permission_denied(&error.to_string()) {
                polkit::copy_with_pkexec(&source_path, &dest_path)?;
            } else {
                return Err(error.to_string());
            }
        }
    }

    Ok(())
}

fn get_unique_destination_path(destination: &Path, name: &str) -> std::path::PathBuf {
    let mut dest_path = destination.join(name);
    let mut counter = 1;

    while dest_path.exists() {
        let path = Path::new(name);
        let stem = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or(name);
        let extension = path.extension().and_then(|ext| ext.to_str());

        let new_name = if let Some(ext) = extension {
            format!("{} ({}).{}", stem, counter, ext)
        } else {
            format!("{} ({})", stem, counter)
        };

        dest_path = destination.join(&new_name);
        counter += 1;
    }

    dest_path
}

#[tauri::command]
pub fn check_conflicts(source_paths: Vec<String>, destination_path: String) -> Vec<ConflictItem> {
    let destination = Path::new(&destination_path);
    let mut conflicts = Vec::new();

    if !destination.exists() || !destination.is_dir() {
        return conflicts;
    }

    for source_path_str in &source_paths {
        let source = Path::new(source_path_str);

        if !source.exists() {
            continue;
        }

        let source_parent = source.parent().map(|parent| normalize_path(&parent.to_string_lossy()));
        let dest_normalized = normalize_path(&destination.to_string_lossy());
        let is_same_directory = source_parent
            .map(|parent| parent == dest_normalized)
            .unwrap_or(false);

        if is_same_directory {
            continue;
        }

        let file_name = match source.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => continue,
        };

        let dest_item_path = destination.join(&file_name);

        if dest_item_path.exists() {
            let source_size = if source.is_file() {
                fs::metadata(source).ok().map(|metadata| metadata.len())
            } else {
                None
            };

            let destination_size = if dest_item_path.is_file() {
                fs::metadata(&dest_item_path).ok().map(|metadata| metadata.len())
            } else {
                None
            };

            conflicts.push(ConflictItem {
                source_path: source_path_str.clone(),
                source_name: file_name,
                source_is_dir: source.is_dir(),
                source_size,
                destination_path: dest_item_path.to_string_lossy().to_string(),
                destination_is_dir: dest_item_path.is_dir(),
                destination_size,
            });
        }
    }

    conflicts
}

fn remove_dir_or_file(path: &Path) -> Result<(), String> {
    let result = if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    };
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            if polkit::is_permission_denied(&error) {
                polkit::remove_with_pkexec(path)
            } else {
                Err(error)
            }
        }
    }
}

#[tauri::command]
pub fn copy_items(source_paths: Vec<String>, destination_path: String, conflict_resolution: Option<String>, operation_id: Option<String>, app: AppHandle) -> FileOperationResult {
    let destination = Path::new(&destination_path);
    let resolution = conflict_resolution
        .map(|value| ConflictResolution::from_str(&value))
        .unwrap_or(ConflictResolution::AutoRename);

    if !destination.exists() {
        return FileOperationResult {
            success: false,
            error: Some(format!("Destination path does not exist: {}", destination_path)),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    if !destination.is_dir() {
        return FileOperationResult {
            success: false,
            error: Some(format!("Destination is not a directory: {}", destination_path)),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    let mut copied_count: u32 = 0;
    let mut failed_count: u32 = 0;
    let mut skipped_count: u32 = 0;
    let mut last_error: Option<String> = None;

    let total = source_paths.len();
    let token = operation_id.as_ref().map(|id| register_operation(id));

    // Undo bookkeeping: only paths we actually created are recorded, so undoing
    // never deletes something that was already there (see `replaced_existing`).
    let mut created: Vec<PathBuf> = Vec::new();
    let mut partial_undo = false;

    for (index, source_path_str) in source_paths.iter().enumerate() {
        if is_cancelled(&token) {
            break;
        }
        emit_progress(&app, &operation_id, "copy", index, total, source_path_str);

        let mut replaced_existing = false;
        let source = Path::new(source_path_str);

        if !source.exists() {
            failed_count += 1;
            last_error = Some(format!("Source path does not exist: {}", source_path_str));
            continue;
        }

        let source_parent = source.parent().map(|parent| normalize_path(&parent.to_string_lossy()));
        let dest_normalized = normalize_path(&destination.to_string_lossy());
        let is_same_directory = source_parent
            .map(|parent| parent == dest_normalized)
            .unwrap_or(false);

        let file_name = match source.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => {
                failed_count += 1;
                last_error = Some(format!("Invalid source path: {}", source_path_str));
                continue;
            }
        };

        let dest_path = if is_same_directory {
            get_unique_destination_path(destination, &file_name)
        } else {
            let initial_dest = destination.join(&file_name);
            if initial_dest.exists() {
                match resolution {
                    ConflictResolution::Skip => {
                        skipped_count += 1;
                        continue;
                    }
                    ConflictResolution::Replace => {
                        if let Err(error) = remove_dir_or_file(&initial_dest) {
                            failed_count += 1;
                            last_error = Some(error);
                            continue;
                        }
                        replaced_existing = true;
                        initial_dest
                    }
                    ConflictResolution::AutoRename => {
                        get_unique_destination_path(destination, &file_name)
                    }
                }
            } else {
                initial_dest
            }
        };

        let result = if source.is_dir() {
            match copy_dir_recursive(source, &dest_path, token.as_ref()) {
                Ok(()) => Ok(()),
                Err(error) => {
                    if polkit::is_permission_denied(&error) {
                        polkit::copy_with_pkexec(source, &dest_path)
                    } else {
                        Err(error)
                    }
                }
            }
        } else {
            match fs::copy(source, &dest_path) {
                Ok(_) => Ok(()),
                Err(error) => {
                    if polkit::is_permission_denied(&error.to_string()) {
                        polkit::copy_with_pkexec(source, &dest_path)
                    } else {
                        Err(error.to_string())
                    }
                }
            }
        };

        match result {
            Ok(()) => {
                copied_count += 1;

                if replaced_existing {
                    // The original at this path is gone for good; deleting the
                    // copy on undo would not bring it back, so leave it alone.
                    partial_undo = true;
                } else {
                    created.push(dest_path);
                }
            }
            Err(error) => {
                failed_count += 1;
                last_error = Some(error);
            }
        }
    }

    emit_progress(&app, &operation_id, "copy", total, total, "");
    if let Some(id) = &operation_id {
        unregister_operation(id);
    }

    undo::push(
        "copy",
        created.len(),
        partial_undo,
        undo::UndoAction::RemoveCreated { paths: created },
    );

    FileOperationResult {
        success: failed_count == 0,
        error: last_error,
        copied_count: Some(copied_count),
        failed_count: Some(failed_count),
        skipped_count: Some(skipped_count),
    }
}

#[tauri::command]
pub fn move_items(source_paths: Vec<String>, destination_path: String, conflict_resolution: Option<String>, operation_id: Option<String>, app: AppHandle) -> FileOperationResult {
    let destination = Path::new(&destination_path);
    let resolution = conflict_resolution
        .map(|value| ConflictResolution::from_str(&value))
        .unwrap_or(ConflictResolution::Skip);

    if !destination.exists() {
        return FileOperationResult {
            success: false,
            error: Some(format!("Destination path does not exist: {}", destination_path)),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    if !destination.is_dir() {
        return FileOperationResult {
            success: false,
            error: Some(format!("Destination is not a directory: {}", destination_path)),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    let mut moved_count: u32 = 0;
    let mut failed_count: u32 = 0;
    let mut skipped_count: u32 = 0;
    let mut last_error: Option<String> = None;

    let total = source_paths.len();
    let token = operation_id.as_ref().map(|id| register_operation(id));

    // Undo bookkeeping: (destination, original) pairs to move back.
    let mut moved_pairs: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut partial_undo = false;

    for (index, source_path_str) in source_paths.iter().enumerate() {
        if is_cancelled(&token) {
            break;
        }
        emit_progress(&app, &operation_id, "move", index, total, source_path_str);

        let mut replaced_existing = false;
        let source = Path::new(source_path_str);

        if !source.exists() {
            failed_count += 1;
            last_error = Some(format!("Source path does not exist: {}", source_path_str));
            continue;
        }

        let source_parent = source.parent().map(|parent| normalize_path(&parent.to_string_lossy()));
        let dest_normalized = normalize_path(&destination.to_string_lossy());
        let is_same_directory = source_parent
            .map(|parent| parent == dest_normalized)
            .unwrap_or(false);

        if is_same_directory {
            continue;
        }

        let file_name = match source.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => {
                failed_count += 1;
                last_error = Some(format!("Invalid source path: {}", source_path_str));
                continue;
            }
        };

        let dest_path = destination.join(&file_name);

        let final_dest_path = if dest_path.exists() {
            match resolution {
                ConflictResolution::Skip => {
                    skipped_count += 1;
                    continue;
                }
                ConflictResolution::Replace => {
                    if let Err(error) = remove_dir_or_file(&dest_path) {
                        failed_count += 1;
                        last_error = Some(error);
                        continue;
                    }
                    replaced_existing = true;
                    dest_path
                }
                ConflictResolution::AutoRename => {
                    get_unique_destination_path(destination, &file_name)
                }
            }
        } else {
            dest_path
        };

        let result = match fs::rename(source, &final_dest_path) {
            Ok(()) => Ok(()),
            Err(error) => {
                let cross_device = error.raw_os_error() == Some(17) || error.raw_os_error() == Some(18);
                if cross_device {
                    let copy_ok = if source.is_dir() {
                        match copy_dir_recursive(source, &final_dest_path, token.as_ref()) {
                            Ok(()) => true,
                            Err(e) if polkit::is_permission_denied(&e) => {
                                polkit::copy_with_pkexec(source, &final_dest_path).is_ok()
                            }
                            Err(_) => false,
                        }
                    } else {
                        match fs::copy(source, &final_dest_path) {
                            Ok(_) => true,
                            Err(e) if polkit::is_permission_denied(&e.to_string()) => {
                                polkit::copy_with_pkexec(source, &final_dest_path).is_ok()
                            }
                            Err(_) => false,
                        }
                    };
                    if copy_ok {
                        let _ = remove_dir_or_file(source);
                        Ok(())
                    } else {
                        Err("Failed to copy across devices even with elevation.".into())
                    }
                } else if polkit::is_permission_denied(&error.to_string()) {
                    polkit::move_with_pkexec(source, &final_dest_path)
                } else {
                    Err(error.to_string())
                }
            }
        };

        match result {
            Ok(()) => {
                moved_count += 1;

                if replaced_existing {
                    // Moving back would leave nothing where the replaced file
                    // was, and that file is unrecoverable — skip it.
                    partial_undo = true;
                } else {
                    moved_pairs.push((final_dest_path, source.to_path_buf()));
                }
            }
            Err(error) => {
                failed_count += 1;
                last_error = Some(error);
            }
        }
    }

    emit_progress(&app, &operation_id, "move", total, total, "");
    if let Some(id) = &operation_id {
        unregister_operation(id);
    }

    undo::push(
        "move",
        moved_pairs.len(),
        partial_undo,
        undo::UndoAction::MoveBack { pairs: moved_pairs },
    );

    FileOperationResult {
        success: failed_count == 0,
        error: last_error,
        copied_count: Some(moved_count),
        failed_count: Some(failed_count),
        skipped_count: Some(skipped_count),
    }
}

#[tauri::command]
pub fn rename_item(source_path: String, new_name: String) -> FileOperationResult {
    let source = Path::new(&source_path);

    if !source.exists() {
        return FileOperationResult {
            success: false,
            error: Some(format!("Source path does not exist: {}", source_path)),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    let parent = match source.parent() {
        Some(parent) => parent,
        None => {
            return FileOperationResult {
                success: false,
                error: Some("Cannot determine parent directory".to_string()),
                copied_count: None,
                failed_count: None,
                skipped_count: None,
            };
        }
    };

    let dest_path = parent.join(&new_name);

    if dest_path.exists() {
        return FileOperationResult {
            success: false,
            error: Some(format!("A file or folder with the name '{}' already exists", new_name)),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    let record_undo = || {
        undo::push(
            "rename",
            1,
            false,
            undo::UndoAction::MoveBack {
                pairs: vec![(dest_path.clone(), source.to_path_buf())],
            },
        );
    };

    match fs::rename(source, &dest_path) {
        Ok(()) => {
            record_undo();

            FileOperationResult {
                success: true,
                error: None,
                copied_count: Some(1),
                failed_count: Some(0),
                skipped_count: Some(0),
            }
        }
        Err(error) => {
            if polkit::is_permission_denied(&error.to_string()) {
                match polkit::rename_with_pkexec(source, &dest_path) {
                    Ok(()) => {
                        record_undo();

                        FileOperationResult {
                            success: true,
                            error: None,
                            copied_count: Some(1),
                            failed_count: Some(0),
                            skipped_count: Some(0),
                        }
                    }
                    Err(e) => FileOperationResult {
                        success: false,
                        error: Some(e),
                        copied_count: None,
                        failed_count: Some(1),
                        skipped_count: None,
                    },
                }
            } else {
                FileOperationResult {
                    success: false,
                    error: Some(error.to_string()),
                    copied_count: None,
                    failed_count: Some(1),
                    skipped_count: None,
                }
            }
        }
    }
}

#[tauri::command]
pub fn delete_items(paths: Vec<String>, use_trash: bool, operation_id: Option<String>, app: AppHandle) -> FileOperationResult {
    let mut deleted_count: u32 = 0;
    let mut failed_count: u32 = 0;
    let mut last_error: Option<String> = None;

    let total = paths.len();
    let token = operation_id.as_ref().map(|id| register_operation(id));

    // Only trashed items can be restored; a permanent delete is not undoable.
    let mut trashed: Vec<PathBuf> = Vec::new();
    let deleted_after = now_secs();

    for (index, path_str) in paths.iter().enumerate() {
        if is_cancelled(&token) {
            break;
        }
        emit_progress(&app, &operation_id, "delete", index, total, path_str);

        let path = Path::new(path_str);

        if !path.exists() {
            failed_count += 1;
            last_error = Some(format!("Path does not exist: {}", path_str));
            continue;
        }

        // Tracks whether the item really reached the trash. The elevated
        // fallback below removes it outright, which is not restorable.
        let mut reached_trash = false;

        let result = if use_trash {
            trash::delete(path).map_err(|error| error.to_string()).map(|()| {
                reached_trash = true;
            }).or_else(|error| {
                if polkit::is_permission_denied(&error) {
                    polkit::remove_with_pkexec(path)
                } else {
                    Err(error)
                }
            })
        } else if path.is_dir() {
            match fs::remove_dir_all(path) {
                Ok(()) => Ok(()),
                Err(error) => {
                    if polkit::is_permission_denied(&error.to_string()) {
                        polkit::remove_with_pkexec(path)
                    } else {
                        Err(error.to_string())
                    }
                }
            }
        } else {
            match fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(error) => {
                    if polkit::is_permission_denied(&error.to_string()) {
                        polkit::remove_with_pkexec(path)
                    } else {
                        Err(error.to_string())
                    }
                }
            }
        };

        match result {
            Ok(()) => {
                deleted_count += 1;

                if reached_trash {
                    trashed.push(path.to_path_buf());
                }
            }
            Err(error) => {
                failed_count += 1;
                last_error = Some(error);
            }
        }
    }

    emit_progress(&app, &operation_id, "delete", total, total, "");
    if let Some(id) = &operation_id {
        unregister_operation(id);
    }

    undo::push(
        "delete",
        trashed.len(),
        false,
        undo::UndoAction::RestoreFromTrash {
            paths: trashed,
            deleted_after,
        },
    );

    FileOperationResult {
        success: failed_count == 0,
        error: last_error,
        copied_count: Some(deleted_count),
        failed_count: Some(failed_count),
        skipped_count: Some(0),
    }
}

#[tauri::command]
pub fn ensure_directory(directory_path: String) -> FileOperationResult {
    let directory = Path::new(&directory_path);

    match fs::create_dir_all(directory) {
        Ok(()) => FileOperationResult {
            success: true,
            error: None,
            copied_count: Some(1),
            failed_count: Some(0),
            skipped_count: Some(0),
        },
        Err(error) => {
            if polkit::is_permission_denied(&error.to_string()) {
                match polkit::create_dir_with_pkexec(directory) {
                    Ok(()) => FileOperationResult {
                        success: true,
                        error: None,
                        copied_count: Some(1),
                        failed_count: Some(0),
                        skipped_count: Some(0),
                    },
                    Err(e) => FileOperationResult {
                        success: false,
                        error: Some(e),
                        copied_count: None,
                        failed_count: Some(1),
                        skipped_count: None,
                    },
                }
            } else {
                FileOperationResult {
                    success: false,
                    error: Some(error.to_string()),
                    copied_count: None,
                    failed_count: Some(1),
                    skipped_count: None,
                }
            }
        }
    }
}

#[tauri::command]
pub fn create_item(directory_path: String, name: String, is_directory: bool) -> FileOperationResult {
    let trimmed_name = name.trim();

    if trimmed_name.is_empty() {
        return FileOperationResult {
            success: false,
            error: Some("Name cannot be empty".to_string()),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    if trimmed_name.contains('/') || trimmed_name.contains('\\') {
        return FileOperationResult {
            success: false,
            error: Some("Name contains invalid path separators".to_string()),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    let directory = Path::new(&directory_path);

    if !directory.exists() {
        return FileOperationResult {
            success: false,
            error: Some(format!("Directory does not exist: {}", directory_path)),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    if !directory.is_dir() {
        return FileOperationResult {
            success: false,
            error: Some(format!("Path is not a directory: {}", directory_path)),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    let dest_path = directory.join(trimmed_name);

    if dest_path.exists() {
        return FileOperationResult {
            success: false,
            error: Some(format!("Path already exists: {}", dest_path.display())),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    let result = if is_directory {
        match fs::create_dir(&dest_path) {
            Ok(()) => Ok(()),
            Err(error) => {
                if polkit::is_permission_denied(&error.to_string()) {
                    polkit::create_dir_with_pkexec(&dest_path)
                } else {
                    Err(error.to_string())
                }
            }
        }
    } else {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest_path)
        {
            Ok(_) => Ok(()),
            Err(error) => {
                if polkit::is_permission_denied(&error.to_string()) {
                    polkit::create_file_with_pkexec(&dest_path)
                } else {
                    Err(error.to_string())
                }
            }
        }
    };

    match result {
        Ok(()) => {
            undo::push(
                "create",
                1,
                false,
                undo::UndoAction::RemoveCreated {
                    paths: vec![dest_path],
                },
            );

            FileOperationResult {
                success: true,
                error: None,
                copied_count: Some(1),
                failed_count: Some(0),
                skipped_count: Some(0),
            }
        }
        Err(error) => FileOperationResult {
            success: false,
            error: Some(error),
            copied_count: None,
            failed_count: Some(1),
            skipped_count: None,
        },
    }
}