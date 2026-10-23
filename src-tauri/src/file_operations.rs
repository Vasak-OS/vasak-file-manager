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

pub(crate) fn emit_progress(
    app: &AppHandle,
    id: &Option<String>,
    kind: &str,
    processed: usize,
    total: usize,
    current: &str,
) {
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

/// Copia una carpeta **sin privilegios**.
///
/// Un error de permisos vuelve tal cual: elevar es decisión de quien llama, y una
/// sola vez para toda la carpeta. Antes pedía la contraseña por cada subcarpeta y
/// por cada archivo que fallaba: una carpeta de doce archivos eran catorce.
fn copy_dir_recursive(
    source: &Path,
    destination: &Path,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    if !destination.exists() {
        fs::create_dir_all(destination).map_err(|error| error.to_string())?;
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
        } else {
            fs::copy(&source_path, &dest_path).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

/// Copia un archivo o una carpeta sin privilegios.
fn copy_unprivileged(
    source: &Path,
    dest_path: &Path,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    if source.is_dir() {
        copy_dir_recursive(source, dest_path, cancel)
    } else {
        fs::copy(source, dest_path)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

/// Lo que no se pudo copiar sin privilegios y espera la elevación de la operación.
struct PendingCopy {
    source: PathBuf,
    dest_path: PathBuf,
    replaced_existing: bool,
}

/// Copia con privilegios lo que no se pudo copiar sin ellos, pidiendo la contraseña
/// **una vez** para todo lo que va con su mismo nombre adentro de `destination`, y
/// una vez más sólo por cada cosa que cambió de nombre (un conflicto resuelto con
/// «renombrar», que es raro). Si la persona rechaza la primera no se vuelve a pedir.
///
/// Devuelve un resultado por elemento, en el mismo orden. Las que van juntas
/// comparten el suyo: si `cp` falla a mitad no se sabe cuáles quedaron copiadas.
fn copy_pending_elevated(
    pending: &[PendingCopy],
    destination: &Path,
    elevation: &polkit::Elevation,
) -> Vec<Result<(), String>> {
    let mut results: Vec<Option<Result<(), String>>> = vec![None; pending.len()];

    let together: Vec<usize> = (0..pending.len())
        .filter(|&i| {
            pending[i].dest_path.parent() == Some(destination)
                && pending[i].dest_path.file_name() == pending[i].source.file_name()
        })
        .collect();
    if !together.is_empty() {
        let sources: Vec<&Path> = together
            .iter()
            .map(|&i| pending[i].source.as_path())
            .collect();
        let outcome = elevation.attempt(|| polkit::copy_into_with_pkexec(&sources, destination));
        for &i in &together {
            results[i] = Some(outcome.clone());
        }
    }

    for (i, item) in pending.iter().enumerate() {
        if results[i].is_none() {
            results[i] = Some(elevation.attempt(|| {
                if item.source.is_dir() {
                    polkit::copy_dir_contents_with_pkexec(&item.source, &item.dest_path)
                } else {
                    polkit::copy_with_pkexec(&item.source, &item.dest_path)
                }
            }));
        }
    }

    results.into_iter().flatten().collect()
}

fn get_unique_destination_path(destination: &Path, name: &str) -> std::path::PathBuf {
    let mut dest_path = destination.join(name);
    let mut counter = 1;

    while dest_path.exists() {
        let path = Path::new(name);
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(name);
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

        let source_parent = source
            .parent()
            .map(|parent| normalize_path(&parent.to_string_lossy()));
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
                fs::metadata(&dest_item_path)
                    .ok()
                    .map(|metadata| metadata.len())
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
pub fn copy_items(
    source_paths: Vec<String>,
    destination_path: String,
    conflict_resolution: Option<String>,
    operation_id: Option<String>,
    app: AppHandle,
) -> FileOperationResult {
    let destination = Path::new(&destination_path);
    let resolution = conflict_resolution
        .map(|value| ConflictResolution::from_str(&value))
        .unwrap_or(ConflictResolution::AutoRename);

    if !destination.exists() {
        return FileOperationResult {
            success: false,
            error: Some(format!(
                "Destination path does not exist: {}",
                destination_path
            )),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    if !destination.is_dir() {
        return FileOperationResult {
            success: false,
            error: Some(format!(
                "Destination is not a directory: {}",
                destination_path
            )),
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

    // Lo que necesita privilegios se junta y se eleva una sola vez al final: una
    // contraseña por operación, no una por archivo ni por carpeta.
    let elevation = polkit::Elevation::new();
    let mut pending: Vec<PendingCopy> = Vec::new();

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

        let source_parent = source
            .parent()
            .map(|parent| normalize_path(&parent.to_string_lossy()));
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
                            // Si no autorizó, no se sigue: lo que viene volvería a pedir.
                            let refused = polkit::is_auth_refused(&error);
                            last_error = Some(error);
                            if refused {
                                elevation.refuse();
                                break;
                            }
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

        match copy_unprivileged(source, &dest_path, token.as_ref()) {
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
            Err(error) if polkit::is_permission_denied(&error) => {
                pending.push(PendingCopy {
                    source: source.to_path_buf(),
                    dest_path,
                    replaced_existing,
                });
            }
            Err(error) => {
                failed_count += 1;
                last_error = Some(error);
            }
        }
    }

    if !pending.is_empty() {
        let results = if is_cancelled(&token) {
            vec![Err("Operation cancelled".to_string()); pending.len()]
        } else {
            copy_pending_elevated(&pending, destination, &elevation)
        };
        for (item, result) in pending.into_iter().zip(results) {
            match result {
                Ok(()) => {
                    copied_count += 1;
                    if item.replaced_existing {
                        partial_undo = true;
                    } else {
                        created.push(item.dest_path);
                    }
                }
                Err(error) => {
                    failed_count += 1;
                    last_error = Some(error);
                }
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
pub fn move_items(
    source_paths: Vec<String>,
    destination_path: String,
    conflict_resolution: Option<String>,
    operation_id: Option<String>,
    app: AppHandle,
) -> FileOperationResult {
    let destination = Path::new(&destination_path);
    let resolution = conflict_resolution
        .map(|value| ConflictResolution::from_str(&value))
        .unwrap_or(ConflictResolution::Skip);

    if !destination.exists() {
        return FileOperationResult {
            success: false,
            error: Some(format!(
                "Destination path does not exist: {}",
                destination_path
            )),
            copied_count: None,
            failed_count: None,
            skipped_count: None,
        };
    }

    if !destination.is_dir() {
        return FileOperationResult {
            success: false,
            error: Some(format!(
                "Destination is not a directory: {}",
                destination_path
            )),
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
    // Una sola autorización para la operación: si se rechaza, no se vuelve a pedir.
    let elevation = polkit::Elevation::new();

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

        let source_parent = source
            .parent()
            .map(|parent| normalize_path(&parent.to_string_lossy()));
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
                let cross_device =
                    error.raw_os_error() == Some(17) || error.raw_os_error() == Some(18);
                if cross_device {
                    let copy_ok = if source.is_dir() {
                        match copy_dir_recursive(source, &final_dest_path, token.as_ref()) {
                            Ok(()) => true,
                            Err(e) if polkit::is_permission_denied(&e) => elevation
                                .attempt(|| {
                                    polkit::copy_dir_contents_with_pkexec(source, &final_dest_path)
                                })
                                .is_ok(),
                            Err(_) => false,
                        }
                    } else {
                        match fs::copy(source, &final_dest_path) {
                            Ok(_) => true,
                            Err(e) if polkit::is_permission_denied(&e.to_string()) => elevation
                                .attempt(|| polkit::copy_with_pkexec(source, &final_dest_path))
                                .is_ok(),
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
                    elevation.attempt(|| polkit::move_with_pkexec(source, &final_dest_path))
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
                // Si no autorizó, el resto de la operación también necesitaría la
                // contraseña: no se la vuelve a pedir.
                if elevation.refused() {
                    break;
                }
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
            error: Some(format!(
                "A file or folder with the name '{}' already exists",
                new_name
            )),
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

/// Borra o manda a la papelera.
///
/// `allow_elevation` por omisión es `true`, que es el comportamiento de siempre:
/// si la papelera falla por permisos, se pide autenticación y se borra definitivo.
/// Se pasa `false` cuando el borrado **no lo pidió la persona explícitamente** —el
/// caso concreto es un arrastre a otra aplicación que negoció mover—, porque ahí un
/// borrado no recuperable sería perder un archivo por una decisión que tomó el
/// programa de destino y no quien arrastró. Sin elevación, si no entra en la
/// papelera el original se queda donde está y se informa el fallo.
#[tauri::command]
pub fn delete_items(
    paths: Vec<String>,
    use_trash: bool,
    operation_id: Option<String>,
    allow_elevation: Option<bool>,
    app: AppHandle,
) -> FileOperationResult {
    let allow_elevation = allow_elevation.unwrap_or(true);
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
            trash::delete(path)
                .map_err(|error| error.to_string())
                .map(|()| {
                    reached_trash = true;
                })
                .or_else(|error| {
                    if allow_elevation && polkit::is_permission_denied(&error) {
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
pub fn create_item(
    directory_path: String,
    name: String,
    is_directory: bool,
) -> FileOperationResult {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::polkit::testing::*;

    /// Una carpeta de origen con `files` archivos y una subcarpeta con otros dos.
    fn source_tree(dir: &Path, files: usize) -> PathBuf {
        let source = dir.join("origen");
        std::fs::create_dir_all(source.join("sub")).unwrap();
        for n in 0..files {
            std::fs::write(source.join(format!("a{n}.txt")), b"x").unwrap();
        }
        std::fs::write(source.join("sub/b1.txt"), b"y").unwrap();
        std::fs::write(source.join("sub/b2.txt"), b"y").unwrap();
        source
    }

    #[test]
    fn copiar_una_carpeta_a_un_destino_sin_permiso_no_pide_la_contrasena_adentro() {
        if running_as_root() {
            return;
        }
        let dir = scratch("copia-sin-pedir");
        let source = source_tree(&dir, 3);
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(&root).unwrap();
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);

        let result = copy_dir_recursive(&source, &root.join("origen"), None);

        // Sin permiso devuelve el error tal cual: elevar es decisión de quien
        // llama, y una sola vez para toda la carpeta. Antes pedía la contraseña
        // por cada subcarpeta y por cada archivo.
        assert!(
            polkit::is_permission_denied(&result.unwrap_err()),
            "tiene que devolver el error de permisos"
        );
        assert_eq!(invocations(&log), Vec::<String>::new());
        cleanup(&dir);
    }

    /// Intenta sin privilegios y junta lo que no pudo, como `copy_files`.
    fn attempt_all(sources: &[&Path], destination: &Path) -> (Vec<PendingCopy>, Vec<PathBuf>) {
        let mut pending = Vec::new();
        let mut copied = Vec::new();
        for source in sources {
            let dest_path = destination.join(source.file_name().unwrap());
            match copy_unprivileged(source, &dest_path, None) {
                Ok(()) => copied.push(dest_path),
                Err(error) => {
                    assert!(polkit::is_permission_denied(&error), "{error}");
                    pending.push(PendingCopy {
                        source: source.to_path_buf(),
                        dest_path,
                        replaced_existing: false,
                    });
                }
            }
        }
        (pending, copied)
    }

    #[test]
    fn una_carpeta_con_muchos_archivos_pide_la_contrasena_una_sola_vez() {
        if running_as_root() {
            return;
        }
        let dir = scratch("carpeta-una-vez");
        let source = source_tree(&dir, 10);
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(&root).unwrap();
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);

        let (pending, copied) = attempt_all(&[&source], &root);
        let results = copy_pending_elevated(&pending, &root, &polkit::Elevation::new());

        assert!(copied.is_empty());
        assert_eq!(results, vec![Ok(())]);
        // Eran catorce con doce archivos: un `mkdir` y un `cp` por cada cosa.
        assert_eq!(invocations(&log).len(), 1, "{:?}", invocations(&log));
        // Y la carpeta quedó entera, con su subcarpeta.
        assert!(root.join("origen/a0.txt").is_file());
        assert!(root.join("origen/a9.txt").is_file());
        assert!(root.join("origen/sub/b2.txt").is_file());
        cleanup(&dir);
    }

    #[test]
    fn varias_cosas_a_un_destino_sin_permiso_piden_la_contrasena_una_sola_vez() {
        if running_as_root() {
            return;
        }
        let dir = scratch("varias-una-vez");
        let folder = source_tree(&dir, 2);
        let file_a = dir.join("uno.txt");
        let file_b = dir.join("dos.txt");
        std::fs::write(&file_a, b"1").unwrap();
        std::fs::write(&file_b, b"2").unwrap();
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(&root).unwrap();
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);

        let (pending, _) = attempt_all(&[&file_a, &folder, &file_b], &root);
        let results = copy_pending_elevated(&pending, &root, &polkit::Elevation::new());

        assert_eq!(pending.len(), 3);
        assert_eq!(results, vec![Ok(()), Ok(()), Ok(())]);
        assert_eq!(invocations(&log).len(), 1, "{:?}", invocations(&log));
        assert!(root.join("uno.txt").is_file());
        assert!(root.join("dos.txt").is_file());
        assert!(root.join("origen/sub/b1.txt").is_file());
        cleanup(&dir);
    }

    #[test]
    fn sin_necesidad_de_privilegios_no_se_pide_nada() {
        let dir = scratch("sin-privilegios");
        let source = source_tree(&dir, 2);
        let destination = dir.join("destino-comun");
        std::fs::create_dir_all(&destination).unwrap();
        let log = install_refusing(&dir, 126);

        let (pending, copied) = attempt_all(&[&source], &destination);

        assert!(pending.is_empty());
        assert_eq!(copied.len(), 1);
        assert!(destination.join("origen/sub/b1.txt").is_file());
        assert_eq!(invocations(&log), Vec::<String>::new());
        cleanup(&dir);
    }

    #[test]
    fn rechazar_la_contrasena_una_vez_no_la_vuelve_a_pedir_por_ninguna_cosa() {
        if running_as_root() {
            return;
        }
        // 126: descartó el diálogo. 127: no se pudo autorizar. Las dos cortan.
        for code in [126, 127] {
            let dir = scratch(&format!("rechazo-{code}"));
            let folder = source_tree(&dir, 2);
            let file_a = dir.join("uno.txt");
            std::fs::write(&file_a, b"1").unwrap();
            let root = dir.join("destino-de-root");
            std::fs::create_dir_all(&root).unwrap();
            make_read_only(&root);
            let log = install_refusing(&dir, code);

            // Dos con su nombre, y una que cambió de nombre (conflicto renombrado).
            let (mut pending, _) = attempt_all(&[&file_a, &folder], &root);
            pending.push(PendingCopy {
                source: file_a.clone(),
                dest_path: root.join("uno (1).txt"),
                replaced_existing: false,
            });
            let results = copy_pending_elevated(&pending, &root, &polkit::Elevation::new());

            assert_eq!(results.len(), 3);
            assert!(
                results
                    .iter()
                    .all(|r| r == &Err(polkit::AUTH_REFUSED.to_string())),
                "{results:?}"
            );
            // Una llamada, la que se rechazó: la de lo renombrado ya no se hace.
            assert_eq!(
                invocations(&log).len(),
                1,
                "código {code}: {:?}",
                invocations(&log)
            );
            cleanup(&dir);
        }
    }

    #[test]
    fn lo_que_cambio_de_nombre_copia_el_contenido_y_no_se_anida() {
        if running_as_root() {
            return;
        }
        let dir = scratch("renombrada");
        let source = source_tree(&dir, 2);
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(root.join("origen (1)")).unwrap();
        std::fs::write(root.join("origen (1)/viejo.txt"), b"v").unwrap();
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);
        let pending = vec![PendingCopy {
            source: source.clone(),
            dest_path: root.join("origen (1)"),
            replaced_existing: false,
        }];

        let results = copy_pending_elevated(&pending, &root, &polkit::Elevation::new());

        assert_eq!(results, vec![Ok(())]);
        assert_eq!(invocations(&log).len(), 1);
        assert!(invocations(&log)[0].contains("cp -r -T --"));
        // Con `cp -r origen "origen (1)"` y el destino existente, quedaba en
        // `origen (1)/origen`: una carpeta a medio copiar se anidaba.
        assert!(root.join("origen (1)/a0.txt").is_file());
        assert!(root.join("origen (1)/sub/b1.txt").is_file());
        assert!(!root.join("origen (1)/origen").exists());
        cleanup(&dir);
    }
}
