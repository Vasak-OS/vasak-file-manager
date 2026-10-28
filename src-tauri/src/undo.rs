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

/// Una entrada de la papelera para la vista: lo que hace falta para mostrarla y
/// restaurarla. La ruta original es la llave con la que `restore_trash` la
/// encuentra de vuelta.
#[derive(Serialize)]
pub struct TrashEntry {
    pub name: String,
    pub original_path: String,
    /// Segundos unix en que se mandó a la papelera.
    pub deleted_time: i64,
}

/// Convierte las entradas del crate a lo que ve la vista y las ordena, la más
/// nueva primero. Separado del listado del sistema para poder probarlo sin una
/// papelera real.
fn trash_entries(items: Vec<trash::TrashItem>) -> Vec<TrashEntry> {
    let mut entries: Vec<TrashEntry> = items
        .into_iter()
        .map(|item| TrashEntry {
            name: item.name.to_string_lossy().into_owned(),
            original_path: item.original_path().to_string_lossy().into_owned(),
            deleted_time: item.time_deleted,
        })
        .collect();

    entries.sort_by(|a, b| b.deleted_time.cmp(&a.deleted_time));
    entries
}

/// Lista la papelera del sistema (freedesktop), lo más nuevo primero.
#[tauri::command]
pub fn list_trash() -> Result<Vec<TrashEntry>, String> {
    let items = trash::os_limited::list().map_err(|error| error.to_string())?;
    Ok(trash_entries(items))
}

/// Restaura las entradas cuya ruta original está en `paths`. Si una ruta se
/// mandó a la papelera más de una vez, restaura la copia más nueva: es lo mismo
/// que hace el deshacer (sin filtro de tiempo acá, de ahí `i64::MIN`).
#[tauri::command]
pub fn restore_trash(paths: Vec<String>) -> Result<usize, String> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    restore_from_trash(&paths, i64::MIN)
}

/// Vacía la papelera: borra definitivamente todo. Devuelve cuántos elementos se
/// borraron.
#[tauri::command]
pub fn empty_trash() -> Result<usize, String> {
    let items = trash::os_limited::list().map_err(|error| error.to_string())?;
    let count = items.len();
    trash::os_limited::purge_all(items).map_err(|error| error.to_string())?;
    Ok(count)
}

fn parent_of(path: &Path) -> Option<String> {
    path.parent()
        .map(|parent| parent.to_string_lossy().to_string())
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

    fn item(name: &str, parent: &str, time_deleted: i64) -> trash::TrashItem {
        trash::TrashItem {
            id: format!("id-{name}").into(),
            name: name.into(),
            original_parent: PathBuf::from(parent),
            time_deleted,
        }
    }

    #[test]
    fn las_entradas_de_la_papelera_salen_con_su_ruta_original() {
        let entries = trash_entries(vec![item("informe.pdf", "/home/pato/Documentos", 100)]);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "informe.pdf");
        assert_eq!(
            entries[0].original_path,
            "/home/pato/Documentos/informe.pdf"
        );
        assert_eq!(entries[0].deleted_time, 100);
    }

    #[test]
    fn las_entradas_de_la_papelera_van_de_la_mas_nueva_a_la_mas_vieja() {
        let entries = trash_entries(vec![
            item("viejo", "/a", 100),
            item("nuevo", "/b", 300),
            item("medio", "/c", 200),
        ]);

        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["nuevo", "medio", "viejo"]);
    }

    #[test]
    fn una_papelera_vacia_da_una_lista_vacia() {
        assert!(trash_entries(Vec::new()).is_empty());
    }

    /// Redirige la papelera de `trash` a un directorio propio y deja el entorno
    /// como estaba al soltarse, aunque la prueba falle a medias. El crate lee
    /// `XDG_DATA_HOME` en cada llamada; ninguna otra prueba toca la papelera.
    struct PapeleraTemporal {
        previo: Option<std::ffi::OsString>,
    }

    impl PapeleraTemporal {
        fn nueva(datos: &Path) -> Self {
            let previo = std::env::var_os("XDG_DATA_HOME");
            std::env::set_var("XDG_DATA_HOME", datos);
            Self { previo }
        }
    }

    impl Drop for PapeleraTemporal {
        fn drop(&mut self) {
            match &self.previo {
                Some(valor) => std::env::set_var("XDG_DATA_HOME", valor),
                None => std::env::remove_var("XDG_DATA_HOME"),
            }
        }
    }

    // `empty_trash` no se prueba a propósito: purga todo lo que `list()`
    // devuelve, incluidas las papeleras de otros montajes, y correr la suite en
    // una máquina de desarrollo borraría cosas de verdad.
    #[test]
    fn lo_que_se_manda_a_la_papelera_se_lista_y_se_restaura() {
        let raiz = temp_dir("papelera");
        let datos = raiz.join("datos");
        fs::create_dir_all(&datos).unwrap();
        let archivo = raiz.join("para-la-papelera.txt");
        fs::write(&archivo, b"contenido").unwrap();

        let resultado = {
            let _papelera = PapeleraTemporal::nueva(&datos);

            trash::delete(&archivo).expect("mandar a la papelera");
            let ruta = archivo.to_string_lossy().into_owned();

            // Por ruta única y no por cantidad: `list()` también ve las
            // papeleras de otros montajes.
            let listada = list_trash()
                .expect("listar")
                .iter()
                .any(|entry| entry.original_path == ruta);
            let existia_en_la_papelera = !archivo.exists();
            let restauradas = restore_trash(vec![ruta]);
            (listada, existia_en_la_papelera, restauradas)
        };

        let (listada, salio_de_su_lugar, restauradas) = resultado;
        let volvio = archivo.exists();
        let _ = fs::remove_dir_all(&raiz);

        assert!(salio_de_su_lugar, "el archivo debía salir de su lugar");
        assert!(listada, "la papelera debía listar el archivo borrado");
        assert_eq!(restauradas, Ok(1));
        assert!(volvio, "el archivo debía volver a su ruta original");
    }

    #[test]
    fn restaurar_una_ruta_que_no_esta_en_la_papelera_falla() {
        let resultado = restore_trash(vec!["/no/existe/vfm-papelera-fantasma.txt".to_string()]);

        assert!(resultado.is_err());
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
        push(
            "copy",
            0,
            false,
            UndoAction::RemoveCreated { paths: Vec::new() },
        );
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
