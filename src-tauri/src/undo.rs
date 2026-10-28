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
/// La pila de rehacer: la inversa de cada operación deshecha. Una operación
/// nueva la vacía (ver `push`), como en cualquier editor: rehacer sólo tiene
/// sentido sobre lo que se acaba de deshacer.
static REDO_STACK: Lazy<Mutex<Vec<UndoEntry>>> = Lazy::new(|| Mutex::new(Vec::new()));
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
    /// "copy" | "move" | "link" | "rename" | "delete" | "create" | "compress"
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

/// Una acción sin nada que hacer: deshacerla o rehacerla sería un no-op, así que
/// no entra a ninguna pila.
fn action_is_empty(action: &UndoAction) -> bool {
    match action {
        UndoAction::RemoveCreated { paths } => paths.is_empty(),
        UndoAction::MoveBack { pairs } => pairs.is_empty(),
        UndoAction::RestoreFromTrash { paths, .. } => paths.is_empty(),
    }
}

fn new_entry(kind: String, item_count: usize, partial: bool, action: UndoAction) -> UndoEntry {
    UndoEntry {
        id: format!("undo-{}", NEXT_ENTRY_ID.fetch_add(1, Ordering::Relaxed)),
        kind,
        item_count,
        partial,
        action,
    }
}

/// Apila una entrada, recortando la más vieja si se pasa del tope.
fn push_entry(stack: &Mutex<Vec<UndoEntry>>, entry: UndoEntry) {
    if let Ok(mut stack) = stack.lock() {
        stack.push(entry);

        if stack.len() > MAX_UNDO_ENTRIES {
            stack.remove(0);
        }
    }
}

/// La inversa de una acción: lo que hay que hacer para rehacer lo que esa acción
/// deshizo (o deshacer lo que rehízo). Mandar a la papelera y restaurar son
/// inversas la una de la otra; mover de vuelta se invierte dando vuelta cada par.
/// `applied_at` es cuándo se aplicó la acción, para que el restaurado de la
/// inversa sólo tome lo que ESA acción mandó a la papelera y no una copia vieja.
fn inverse_action(action: &UndoAction, applied_at: i64) -> UndoAction {
    match action {
        UndoAction::RemoveCreated { paths } => UndoAction::RestoreFromTrash {
            paths: paths.clone(),
            deleted_after: applied_at,
        },
        UndoAction::MoveBack { pairs } => UndoAction::MoveBack {
            pairs: pairs
                .iter()
                .map(|(current, original)| (original.clone(), current.clone()))
                .collect(),
        },
        UndoAction::RestoreFromTrash { paths, .. } => UndoAction::RemoveCreated {
            paths: paths.clone(),
        },
    }
}

/// Records the inverse of a just-completed operation. Entries with nothing to
/// undo are dropped so the UI never offers a no-op undo. Una operación nueva
/// invalida la pila de rehacer, como en cualquier editor.
pub fn push(kind: &str, item_count: usize, partial: bool, action: UndoAction) {
    if action_is_empty(&action) {
        return;
    }

    if let Ok(mut redo) = REDO_STACK.lock() {
        redo.clear();
    }

    push_entry(
        &UNDO_STACK,
        new_entry(kind.to_string(), item_count, partial, action),
    );
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

impl UndoResult {
    /// Un resultado sin nada hecho: la pila vacía, o el candado envenenado.
    fn failed(error: String) -> Self {
        UndoResult {
            success: false,
            error: Some(error),
            kind: None,
            undone_count: 0,
            failed_count: 0,
            affected_paths: Vec::new(),
        }
    }
}

/// Lo que dejó aplicar una acción: cuántos ítems salieron, cuántos no, el último
/// error y los directorios a refrescar (ordenados, sin repetir).
struct ActionOutcome {
    undone_count: usize,
    failed_count: usize,
    last_error: Option<String>,
    affected: Vec<String>,
}

/// Aplica una acción sobre el disco. Deshacer y rehacer son lo mismo —aplicar una
/// acción—, así que la mecánica vive acá una sola vez.
fn apply_action(action: &UndoAction) -> ActionOutcome {
    let mut undone_count = 0usize;
    let mut failed_count = 0usize;
    let mut last_error: Option<String> = None;
    let mut affected: Vec<String> = Vec::new();

    match action {
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

    ActionOutcome {
        undone_count,
        failed_count,
        last_error,
        affected,
    }
}

/// Saca la última entrada de `from`, la aplica, y si salió completa apila su
/// inversa en `to`, para poder deshacer lo que se acaba de hacer. Deshacer y
/// rehacer son la misma mecánica con las pilas al revés.
fn run_step(
    from: &Mutex<Vec<UndoEntry>>,
    to: &Mutex<Vec<UndoEntry>>,
    nothing_message: &str,
) -> UndoResult {
    let entry = match from.lock() {
        Ok(mut stack) => stack.pop(),
        Err(error) => return UndoResult::failed(error.to_string()),
    };

    let Some(entry) = entry else {
        return UndoResult::failed(nothing_message.to_string());
    };

    // Antes de aplicar: lo que la inversa de `RemoveCreated` tiene que restaurar
    // es lo que esta aplicación manda a la papelera ahora, no una copia vieja.
    let applied_at = now_secs();
    let outcome = apply_action(&entry.action);
    let success = outcome.failed_count == 0 && outcome.undone_count > 0;

    // Sólo si salió completa: apilar la inversa de un paso a medio hacer dejaría
    // la pila opuesta ofreciendo deshacer algo que no pasó del todo.
    if success {
        push_entry(
            to,
            new_entry(
                entry.kind.clone(),
                entry.item_count,
                false,
                inverse_action(&entry.action, applied_at),
            ),
        );
    }

    UndoResult {
        success,
        error: outcome.last_error,
        kind: Some(entry.kind),
        undone_count: outcome.undone_count,
        failed_count: outcome.failed_count,
        affected_paths: outcome.affected,
    }
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
    if let Ok(mut redo) = REDO_STACK.lock() {
        redo.clear();
    }
}

#[tauri::command]
pub fn undo_last_operation() -> UndoResult {
    run_step(&UNDO_STACK, &REDO_STACK, "Nothing to undo")
}

/// Describe la operación que un `redo_last_operation` volvería a hacer.
#[tauri::command]
pub fn get_redo_info() -> Option<UndoInfo> {
    let stack = REDO_STACK.lock().ok()?;

    stack.last().map(|entry| UndoInfo {
        id: entry.id.clone(),
        kind: entry.kind.clone(),
        item_count: entry.item_count,
        partial: entry.partial,
    })
}

/// Rehace la última operación deshecha: aplica la inversa que quedó en la pila de
/// rehacer y, si sale, la vuelve a dejar deshacible en la pila de deshacer.
#[tauri::command]
pub fn redo_last_operation() -> UndoResult {
    run_step(&REDO_STACK, &UNDO_STACK, "Nothing to redo")
}

#[cfg(test)]
pub(crate) mod tests {
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
        // Declarado después de `previo`: se suelta al final de `drop`, con el
        // entorno ya restaurado. `XDG_DATA_HOME` es del proceso entero, así que
        // dos pruebas con su propia papelera no pueden correr a la vez.
        _candado: std::sync::MutexGuard<'static, ()>,
    }

    static CANDADO_PAPELERA: Mutex<()> = Mutex::new(());

    /// Los statics `UNDO_STACK`/`REDO_STACK` son del proceso: quien los toque
    /// toma este candado.
    pub(crate) static CANDADO_PILAS: Mutex<()> = Mutex::new(());

    impl PapeleraTemporal {
        fn nueva(datos: &Path) -> Self {
            let candado = CANDADO_PAPELERA.lock().unwrap_or_else(|e| e.into_inner());
            let previo = std::env::var_os("XDG_DATA_HOME");
            std::env::set_var("XDG_DATA_HOME", datos);
            Self {
                previo,
                _candado: candado,
            }
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
        let _pilas = CANDADO_PILAS.lock().unwrap_or_else(|e| e.into_inner());
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

    // ---- Rehacer (#145) -------------------------------------------------

    fn ruta(texto: &str) -> PathBuf {
        PathBuf::from(texto)
    }

    fn pila() -> Mutex<Vec<UndoEntry>> {
        Mutex::new(Vec::new())
    }

    fn con(accion: UndoAction) -> Mutex<Vec<UndoEntry>> {
        Mutex::new(vec![new_entry("move".into(), 1, false, accion)])
    }

    fn mover(pares: Vec<(PathBuf, PathBuf)>) -> UndoAction {
        UndoAction::MoveBack { pairs: pares }
    }

    fn profundidad(pila: &Mutex<Vec<UndoEntry>>) -> usize {
        pila.lock().unwrap().len()
    }

    /// La acción de la última entrada de una pila, para mirar qué quedó apilado.
    fn tope(pila: &Mutex<Vec<UndoEntry>>) -> UndoAction {
        pila.lock()
            .unwrap()
            .last()
            .expect("pila vacía")
            .action
            .clone()
    }

    #[test]
    fn la_inversa_de_crear_es_restaurar_de_la_papelera_desde_ese_momento() {
        let inversa = inverse_action(
            &UndoAction::RemoveCreated {
                paths: vec![ruta("/a"), ruta("/b")],
            },
            1234,
        );

        match inversa {
            UndoAction::RestoreFromTrash {
                paths,
                deleted_after,
            } => {
                assert_eq!(paths, [ruta("/a"), ruta("/b")]);
                assert_eq!(deleted_after, 1234);
            }
            otra => panic!("se esperaba RestoreFromTrash, salió {otra:?}"),
        }
    }

    #[test]
    fn la_inversa_de_restaurar_de_la_papelera_es_quitar_lo_creado() {
        let inversa = inverse_action(
            &UndoAction::RestoreFromTrash {
                paths: vec![ruta("/a")],
                deleted_after: 5,
            },
            999,
        );

        match inversa {
            UndoAction::RemoveCreated { paths } => assert_eq!(paths, [ruta("/a")]),
            otra => panic!("se esperaba RemoveCreated, salió {otra:?}"),
        }
    }

    #[test]
    fn la_inversa_de_mover_da_vuelta_cada_par_y_conserva_el_orden() {
        let inversa = inverse_action(
            &mover(vec![
                (ruta("/dest/a"), ruta("/orig/a")),
                (ruta("/dest/b"), ruta("/orig/b")),
            ]),
            0,
        );

        match inversa {
            UndoAction::MoveBack { pairs } => assert_eq!(
                pairs,
                [
                    (ruta("/orig/a"), ruta("/dest/a")),
                    (ruta("/orig/b"), ruta("/dest/b"))
                ]
            ),
            otra => panic!("se esperaba MoveBack, salió {otra:?}"),
        }
    }

    #[test]
    fn invertir_dos_veces_devuelve_la_accion_original() {
        let pares = vec![(ruta("/x/a"), ruta("/y/a"))];
        match inverse_action(&inverse_action(&mover(pares.clone()), 1), 2) {
            UndoAction::MoveBack { pairs } => assert_eq!(pairs, pares),
            otra => panic!("se esperaba MoveBack, salió {otra:?}"),
        }

        let creadas = vec![ruta("/c"), ruta("/d")];
        let ida_y_vuelta = inverse_action(
            &inverse_action(
                &UndoAction::RemoveCreated {
                    paths: creadas.clone(),
                },
                10,
            ),
            20,
        );
        match ida_y_vuelta {
            UndoAction::RemoveCreated { paths } => assert_eq!(paths, creadas),
            otra => panic!("se esperaba RemoveCreated, salió {otra:?}"),
        }

        // Desde el otro extremo el instante se reescribe: lo que importa es
        // que el de la vuelta sea el del último `applied_at`.
        let vuelta = inverse_action(
            &inverse_action(
                &UndoAction::RestoreFromTrash {
                    paths: creadas.clone(),
                    deleted_after: 1,
                },
                50,
            ),
            60,
        );
        match vuelta {
            UndoAction::RestoreFromTrash {
                paths,
                deleted_after,
            } => {
                assert_eq!(paths, creadas);
                assert_eq!(deleted_after, 60);
            }
            otra => panic!("se esperaba RestoreFromTrash, salió {otra:?}"),
        }
    }

    #[test]
    fn una_accion_sin_nada_que_hacer_esta_vacia_y_una_con_contenido_no() {
        assert!(action_is_empty(&UndoAction::RemoveCreated {
            paths: vec![]
        }));
        assert!(action_is_empty(&mover(vec![])));
        assert!(action_is_empty(&UndoAction::RestoreFromTrash {
            paths: vec![],
            deleted_after: 7,
        }));

        assert!(!action_is_empty(&UndoAction::RemoveCreated {
            paths: vec![ruta("/a")]
        }));
        assert!(!action_is_empty(&mover(vec![(ruta("/a"), ruta("/b"))])));
        assert!(!action_is_empty(&UndoAction::RestoreFromTrash {
            paths: vec![ruta("/a")],
            deleted_after: 7,
        }));
    }

    #[test]
    fn una_pila_llena_descarta_la_entrada_mas_vieja() {
        let pila = pila();
        for indice in 0..(MAX_UNDO_ENTRIES + 3) {
            push_entry(
                &pila,
                new_entry(
                    format!("k{indice}"),
                    1,
                    false,
                    mover(vec![(ruta("/a"), ruta("/b"))]),
                ),
            );
        }

        let pila = pila.lock().unwrap();
        assert_eq!(pila.len(), MAX_UNDO_ENTRIES);
        assert_eq!(pila[0].kind, "k3", "se descartan las más viejas");
        assert_eq!(
            pila.last().unwrap().kind,
            format!("k{}", MAX_UNDO_ENTRIES + 2)
        );
    }

    #[test]
    fn con_la_pila_vacia_no_hay_nada_que_hacer_y_el_mensaje_es_el_pedido() {
        let (desde, hasta) = (pila(), pila());

        let resultado = run_step(&desde, &hasta, "Nothing to redo");

        assert!(!resultado.success);
        assert_eq!(resultado.error.as_deref(), Some("Nothing to redo"));
        assert_eq!(resultado.undone_count, 0);
        assert_eq!(profundidad(&hasta), 0);
    }

    #[test]
    fn un_movimiento_se_deshace_y_se_rehace_de_verdad_en_el_disco() {
        let dir = temp_dir("ida-y-vuelta");
        let origen = dir.join("a.txt");
        let destino = dir.join("b.txt");
        fs::write(&destino, b"contenido").unwrap();

        // La operación original movió a -> b; deshacerla es b -> a.
        let (deshacer, rehacer) = (con(mover(vec![(destino.clone(), origen.clone())])), pila());

        let paso = run_step(&deshacer, &rehacer, "x");
        assert!(paso.success, "deshacer falló: {:?}", paso.error);
        assert_eq!(paso.kind.as_deref(), Some("move"));
        assert_eq!((paso.undone_count, paso.failed_count), (1, 0));
        assert_eq!(paso.affected_paths, [dir.to_string_lossy().into_owned()]);
        assert!(origen.exists() && !destino.exists());
        assert_eq!(profundidad(&deshacer), 0);
        match tope(&rehacer) {
            UndoAction::MoveBack { pairs } => {
                assert_eq!(pairs, [(origen.clone(), destino.clone())])
            }
            otra => panic!("se esperaba MoveBack, salió {otra:?}"),
        }

        // Rehacer es el mismo paso con las pilas al revés: a -> b otra vez.
        let paso = run_step(&rehacer, &deshacer, "y");
        assert!(paso.success, "rehacer falló: {:?}", paso.error);
        assert!(destino.exists() && !origen.exists());
        assert_eq!(fs::read(&destino).unwrap(), b"contenido");
        assert_eq!(profundidad(&rehacer), 0);
        match tope(&deshacer) {
            UndoAction::MoveBack { pairs } => assert_eq!(pairs, [(destino, origen)]),
            otra => panic!("se esperaba MoveBack, salió {otra:?}"),
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_paso_fallido_no_deja_su_inversa_en_la_otra_pila() {
        let dir = temp_dir("paso-fallido");
        let (deshacer, rehacer) = (
            con(mover(vec![(dir.join("no-existe"), dir.join("original"))])),
            pila(),
        );

        let paso = run_step(&deshacer, &rehacer, "x");

        assert!(!paso.success);
        assert_eq!((paso.undone_count, paso.failed_count), (0, 1));
        assert!(paso.error.is_some());
        assert_eq!(
            profundidad(&rehacer),
            0,
            "no se ofrece rehacer lo que no pasó"
        );
        assert_eq!(profundidad(&deshacer), 0, "la entrada se consume igual");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn un_paso_que_no_hizo_nada_no_cuenta_como_exito_ni_apila_la_inversa() {
        let (deshacer, rehacer) = (con(mover(vec![])), pila());

        let paso = run_step(&deshacer, &rehacer, "x");

        assert!(!paso.success);
        assert_eq!((paso.undone_count, paso.failed_count), (0, 0));
        assert_eq!(profundidad(&rehacer), 0);
    }

    #[test]
    fn un_paso_a_medias_no_apila_la_inversa_pero_deja_hecho_lo_que_pudo() {
        let dir = temp_dir("paso-a-medias");
        let (bien, mal) = (dir.join("bien"), dir.join("mal"));
        fs::write(&bien, b"1").unwrap();
        let (deshacer, rehacer) = (
            con(mover(vec![
                (bien.clone(), dir.join("bien-original")),
                (mal, dir.join("mal-original")),
            ])),
            pila(),
        );

        let paso = run_step(&deshacer, &rehacer, "x");

        assert!(!paso.success);
        assert_eq!((paso.undone_count, paso.failed_count), (1, 1));
        assert!(dir.join("bien-original").exists());
        assert_eq!(profundidad(&rehacer), 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn deshacer_y_rehacer_una_copia_pasa_por_la_papelera_y_vuelve() {
        let raiz = temp_dir("copia-papelera");
        let datos = raiz.join("datos");
        fs::create_dir_all(&datos).unwrap();
        let copia = raiz.join("copia.txt");
        fs::write(&copia, b"copiado").unwrap();

        let _papelera = PapeleraTemporal::nueva(&datos);
        let (deshacer, rehacer) = (
            con(UndoAction::RemoveCreated {
                paths: vec![copia.clone()],
            }),
            pila(),
        );

        // Deshacer la copia la manda a la papelera: no se destruye.
        let paso = run_step(&deshacer, &rehacer, "x");
        assert!(paso.success, "deshacer falló: {:?}", paso.error);
        assert!(!copia.exists());
        match tope(&rehacer) {
            UndoAction::RestoreFromTrash { paths, .. } => assert_eq!(paths, [copia.clone()]),
            otra => panic!("se esperaba RestoreFromTrash, salió {otra:?}"),
        }

        // Rehacerla la saca de la papelera con su contenido.
        let paso = run_step(&rehacer, &deshacer, "y");
        assert!(paso.success, "rehacer falló: {:?}", paso.error);
        assert_eq!(fs::read(&copia).unwrap(), b"copiado");
        match tope(&deshacer) {
            UndoAction::RemoveCreated { paths } => assert_eq!(paths, [copia.clone()]),
            otra => panic!("se esperaba RemoveCreated, salió {otra:?}"),
        }

        drop(_papelera);
        let _ = fs::remove_dir_all(&raiz);
    }

    #[test]
    fn restaurar_algo_que_no_esta_en_la_papelera_falla_y_no_apila_nada() {
        let raiz = temp_dir("restaurar-fantasma");
        let datos = raiz.join("datos");
        fs::create_dir_all(&datos).unwrap();

        let _papelera = PapeleraTemporal::nueva(&datos);
        let (rehacer, deshacer) = (
            con(UndoAction::RestoreFromTrash {
                paths: vec![raiz.join("fantasma.txt")],
                deleted_after: 0,
            }),
            pila(),
        );

        let paso = run_step(&rehacer, &deshacer, "x");

        assert!(!paso.success);
        assert_eq!((paso.undone_count, paso.failed_count), (0, 1));
        assert!(paso.error.is_some());
        assert_eq!(profundidad(&deshacer), 0);

        drop(_papelera);
        let _ = fs::remove_dir_all(&raiz);
    }

    /// Las pilas globales, de punta a punta con los comandos. Es una sola prueba
    /// y toma el candado de las pilas: son del proceso y Rust corre en paralelo.
    #[test]
    fn los_comandos_deshacen_rehacen_y_una_operacion_nueva_borra_el_rehacer() {
        let _pilas = CANDADO_PILAS.lock().unwrap_or_else(|e| e.into_inner());
        clear_undo_history();
        assert!(get_redo_info().is_none());
        assert!(
            !redo_last_operation().success,
            "sin nada deshecho no hay qué rehacer"
        );

        let dir = temp_dir("comandos");
        let origen = dir.join("a.txt");
        let destino = dir.join("b.txt");
        fs::write(&destino, b"x").unwrap();
        push(
            "move",
            1,
            false,
            mover(vec![(destino.clone(), origen.clone())]),
        );

        assert!(undo_last_operation().success);
        assert!(get_undo_info().is_none());
        let rehacer = get_redo_info().expect("lo deshecho se puede rehacer");
        assert_eq!((rehacer.kind.as_str(), rehacer.item_count), ("move", 1));

        assert!(redo_last_operation().success);
        assert!(destino.exists() && !origen.exists());
        assert!(get_redo_info().is_none());
        assert!(get_undo_info().is_some(), "y se vuelve a poder deshacer");

        // Deshacer de nuevo y hacer algo nuevo: el rehacer ya no corresponde.
        assert!(undo_last_operation().success);
        assert!(get_redo_info().is_some());
        push("move", 1, false, mover(vec![(ruta("/n/a"), ruta("/n/b"))]));
        assert!(get_redo_info().is_none());

        // Una acción vacía no es una operación nueva: no invalida el rehacer.
        clear_undo_history();
        push(
            "move",
            1,
            false,
            mover(vec![(origen.clone(), destino.clone())]),
        );
        assert!(undo_last_operation().success);
        push(
            "copy",
            0,
            false,
            UndoAction::RemoveCreated { paths: vec![] },
        );
        assert!(get_redo_info().is_some());

        // Vaciar el historial vacía las dos pilas.
        clear_undo_history();
        assert!(get_undo_info().is_none() && get_redo_info().is_none());

        let _ = fs::remove_dir_all(&dir);
    }
}
