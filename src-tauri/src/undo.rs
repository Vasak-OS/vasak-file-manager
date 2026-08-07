use once_cell::sync::Lazy;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::polkit;

/// Bounded so a long session can't grow the stack without limit.
const MAX_UNDO_ENTRIES: usize = 50;

static UNDO_STACK: Lazy<Mutex<Vec<UndoEntry>>> = Lazy::new(|| Mutex::new(Vec::new()));
static NEXT_ENTRY_ID: AtomicU64 = AtomicU64::new(1);

/// The inverse of an operation that already succeeded.
#[derive(Debug, Clone)]
pub enum UndoAction {
    /// Remove paths the operation created (copy, create, compress).
    RemoveCreated { paths: Vec<PathBuf> },
    /// Move each `current` back to `original` (move, rename).
    MoveBack { pairs: Vec<(PathBuf, PathBuf)> },
    /// Restore trashed items whose original path is listed and that were
    /// deleted at or after `deleted_after` (unix seconds).
    RestoreFromTrash {
        paths: Vec<PathBuf>,
        deleted_after: i64,
    },
}

#[derive(Debug, Clone)]
pub struct UndoEntry {
    pub id: String,
    /// "copy" | "move" | "rename" | "delete" | "create" | "compress"
    pub kind: String,
    pub item_count: usize,
    /// True when some items of the original operation can't be undone (e.g. a
    /// conflict was resolved by replacing an existing file, which we never
    /// delete on undo because the replaced original is unrecoverable).
    pub partial: bool,
    pub action: UndoAction,
}

/// What the UI needs to label the undo affordance.
#[derive(Serialize, Clone)]
pub struct UndoInfo {
    pub id: String,
    pub kind: String,
    pub item_count: usize,
    pub partial: bool,
}

#[derive(Serialize)]
pub struct UndoResult {
    pub success: bool,
    pub error: Option<String>,
    pub kind: Option<String>,
    pub undone_count: usize,
    pub failed_count: usize,
    /// Directories the UI should refresh / invalidate after the undo.
    pub affected_paths: Vec<String>,
}

pub(crate) fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

/// Records the inverse of a just-completed operation. Entries with nothing to
/// undo are dropped so the UI never offers a no-op undo.
pub fn push(kind: &str, item_count: usize, partial: bool, action: UndoAction) {
    let is_empty = match &action {
        UndoAction::RemoveCreated { paths } => paths.is_empty(),
        UndoAction::MoveBack { pairs } => pairs.is_empty(),
        UndoAction::RestoreFromTrash { paths, .. } => paths.is_empty(),
    };

    if is_empty {
        return;
    }

    let entry = UndoEntry {
        id: format!("undo-{}", NEXT_ENTRY_ID.fetch_add(1, Ordering::Relaxed)),
        kind: kind.to_string(),
        item_count,
        partial,
        action,
    };

    if let Ok(mut stack) = UNDO_STACK.lock() {
        stack.push(entry);

        if stack.len() > MAX_UNDO_ENTRIES {
            stack.remove(0);
        }
    }
}

/// Removes a path created by the undone operation. Goes through the trash so an
/// undo can itself never destroy data irrecoverably; falls back to a hard
/// delete (and then to pkexec) when the trash is unavailable.
fn remove_created(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    if trash::delete(path).is_ok() {
        return Ok(());
    }

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

fn move_back(current: &Path, original: &Path) -> Result<(), String> {
    if !current.exists() {
        return Err(format!("Item no longer exists: {}", current.display()));
    }

    if original.exists() {
        return Err(format!(
            "Cannot restore, something already occupies {}",
            original.display()
        ));
    }

    if let Some(parent) = original.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }

    match fs::rename(current, original) {
        Ok(()) => Ok(()),
        Err(error) => {
            if polkit::is_permission_denied(&error.to_string()) {
                polkit::move_with_pkexec(current, original)
            } else {
                Err(error.to_string())
            }
        }
    }
}

/// Restores the trashed items matching `paths` that were deleted at or after
/// `deleted_after`. When the same path was trashed more than once only the most
/// recent copy is restored, both because that is the one the undone operation
/// created and because `restore_all` rejects two items sharing an original path.
fn restore_from_trash(paths: &[PathBuf], deleted_after: i64) -> Result<usize, String> {
    let wanted: std::collections::HashSet<&PathBuf> = paths.iter().collect();

    let items = trash::os_limited::list().map_err(|error| error.to_string())?;

    let mut newest: std::collections::HashMap<PathBuf, trash::TrashItem> =
        std::collections::HashMap::new();

    for item in items {
        let original = item.original_path();

        if !wanted.contains(&original) || item.time_deleted < deleted_after {
            continue;
        }

        newest
            .entry(original)
            .and_modify(|existing| {
                if item.time_deleted > existing.time_deleted {
                    *existing = item.clone();
                }
            })
            .or_insert(item);
    }

    if newest.is_empty() {
        return Err("No matching items found in trash".to_string());
    }

    let count = newest.len();
    let to_restore: Vec<trash::TrashItem> = newest.into_values().collect();

    trash::os_limited::restore_all(to_restore).map_err(|error| error.to_string())?;

    Ok(count)
}

fn parent_of(path: &Path) -> Option<String> {
    path.parent().map(|parent| parent.to_string_lossy().to_string())
}

/// Describes the operation that a call to `undo_last_operation` would reverse.
#[tauri::command]
pub fn get_undo_info() -> Option<UndoInfo> {
    let stack = UNDO_STACK.lock().ok()?;

    stack.last().map(|entry| UndoInfo {
        id: entry.id.clone(),
        kind: entry.kind.clone(),
        item_count: entry.item_count,
        partial: entry.partial,
    })
}

#[tauri::command]
pub fn clear_undo_history() {
    if let Ok(mut stack) = UNDO_STACK.lock() {
        stack.clear();
    }
}

#[tauri::command]
pub fn undo_last_operation() -> UndoResult {
    let entry = match UNDO_STACK.lock() {
        Ok(mut stack) => stack.pop(),
        Err(error) => {
            return UndoResult {
                success: false,
                error: Some(error.to_string()),
                kind: None,
                undone_count: 0,
                failed_count: 0,
                affected_paths: Vec::new(),
            };
        }
    };

    let Some(entry) = entry else {
        return UndoResult {
            success: false,
            error: Some("Nothing to undo".to_string()),
            kind: None,
            undone_count: 0,
            failed_count: 0,
            affected_paths: Vec::new(),
        };
    };

    let mut undone_count = 0usize;
    let mut failed_count = 0usize;
    let mut last_error: Option<String> = None;
    let mut affected: Vec<String> = Vec::new();

    match &entry.action {
        UndoAction::RemoveCreated { paths } => {
            for path in paths {
                if let Some(parent) = parent_of(path) {
                    affected.push(parent);
                }

                match remove_created(path) {
                    Ok(()) => undone_count += 1,
                    Err(error) => {
                        failed_count += 1;
                        last_error = Some(error);
                    }
                }
            }
        }
        UndoAction::MoveBack { pairs } => {
            for (current, original) in pairs {
                if let Some(parent) = parent_of(current) {
                    affected.push(parent);
                }

                if let Some(parent) = parent_of(original) {
                    affected.push(parent);
                }

                match move_back(current, original) {
                    Ok(()) => undone_count += 1,
                    Err(error) => {
                        failed_count += 1;
                        last_error = Some(error);
                    }
                }
            }
        }
        UndoAction::RestoreFromTrash {
            paths,
            deleted_after,
        } => {
            for path in paths {
                if let Some(parent) = parent_of(path) {
                    affected.push(parent);
                }
            }

            match restore_from_trash(paths, *deleted_after) {
                Ok(count) => undone_count = count,
                Err(error) => {
                    failed_count = paths.len();
                    last_error = Some(error);
                }
            }
        }
    }

    affected.sort();
    affected.dedup();

    UndoResult {
        success: failed_count == 0 && undone_count > 0,
        error: last_error,
        kind: Some(entry.kind),
        undone_count,
        failed_count,
        affected_paths: affected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vfm-undo-test-{}", tag));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("failed to create temp dir");
        dir
    }

    #[test]
    fn move_back_restores_the_original_location() {
        let dir = temp_dir("restore");
        let original = dir.join("original.txt");
        let moved = dir.join("moved.txt");
        fs::write(&moved, b"content").unwrap();

        move_back(&moved, &original).expect("move back should succeed");

        assert!(original.exists(), "original path should be restored");
        assert!(!moved.exists(), "moved path should be gone");
        assert_eq!(fs::read(&original).unwrap(), b"content");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_back_refuses_to_overwrite_an_occupied_destination() {
        let dir = temp_dir("occupied");
        let original = dir.join("original.txt");
        let moved = dir.join("moved.txt");
        fs::write(&original, b"existing").unwrap();
        fs::write(&moved, b"new").unwrap();

        assert!(move_back(&moved, &original).is_err());
        assert_eq!(
            fs::read(&original).unwrap(),
            b"existing",
            "the occupant must not be clobbered"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_back_recreates_a_missing_parent_directory() {
        let dir = temp_dir("parent");
        let original = dir.join("gone").join("original.txt");
        let moved = dir.join("moved.txt");
        fs::write(&moved, b"content").unwrap();

        move_back(&moved, &original).expect("move back should recreate the parent");

        assert!(original.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    /// All stack assertions live in one test because the stack is global and
    /// Rust runs tests in parallel.
    #[test]
    fn stack_records_pops_and_bounds_entries() {
        clear_undo_history();

        // An action with nothing to reverse is never offered to the user.
        push("copy", 0, false, UndoAction::RemoveCreated { paths: Vec::new() });
        assert!(get_undo_info().is_none());

        let dir = temp_dir("stack");
        let original = dir.join("original.txt");
        let moved = dir.join("moved.txt");
        fs::write(&moved, b"content").unwrap();

        push(
            "move",
            1,
            false,
            UndoAction::MoveBack {
                pairs: vec![(moved.clone(), original.clone())],
            },
        );

        let info = get_undo_info().expect("entry should be on the stack");
        assert_eq!(info.kind, "move");
        assert_eq!(info.item_count, 1);

        let result = undo_last_operation();
        assert!(result.success, "undo failed: {:?}", result.error);
        assert_eq!(result.undone_count, 1);
        assert!(original.exists());
        assert!(!moved.exists());

        // Popped, so there is nothing left to undo.
        assert!(get_undo_info().is_none());
        assert!(!undo_last_operation().success);

        // The stack never grows past its bound.
        for index in 0..(MAX_UNDO_ENTRIES + 10) {
            push(
                "rename",
                1,
                false,
                UndoAction::MoveBack {
                    pairs: vec![(
                        PathBuf::from(format!("/nonexistent/{}", index)),
                        PathBuf::from(format!("/nonexistent/original-{}", index)),
                    )],
                },
            );
        }

        let depth = UNDO_STACK.lock().unwrap().len();
        assert_eq!(depth, MAX_UNDO_ENTRIES);

        clear_undo_history();
        let _ = fs::remove_dir_all(&dir);
    }
}
