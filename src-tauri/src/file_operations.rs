use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};

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
    /// Bytes copiados hasta ahora (0 en move/delete o cuando no se sabe).
    processed_bytes: u64,
    /// Total de bytes a copiar (0 cuando no se sabe).
    total_bytes: u64,
    /// Velocidad promedio (0 cuando no se sabe); el frontend calcula la ETA.
    bytes_per_second: u64,
}

/// Progreso por archivos, sin información de bytes: los tres campos nuevos van en
/// 0 y el frontend cae al conteo de archivos. Lo usan move y delete.
pub(crate) fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
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
                processed_bytes: 0,
                total_bytes: 0,
                bytes_per_second: 0,
            },
        );
    }
}

/// Cada cuánto, como mucho, se emite un evento de progreso de copia: no inundar
/// el bridge de Tauri con uno por chunk.
const PROGRESS_THROTTLE: Duration = Duration::from_millis(100);

/// Tamaño de un camino en bytes, recursivo, **sin seguir symlinks**
/// (`symlink_metadata`): así no se cuenta de más ni se cae en un ciclo. Lo que no
/// se puede leer suma 0: el total es sólo para la barra, mejor esfuerzo.
pub(crate) fn path_size(path: &Path) -> u64 {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return 0,
    };
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        0
    } else if file_type.is_dir() {
        let mut total = 0;
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                total += path_size(&entry.path());
            }
        }
        total
    } else {
        metadata.len()
    }
}

/// Total de bytes de los orígenes que existen, para precalcular `total_bytes`.
pub(crate) fn total_source_bytes(source_paths: &[String]) -> u64 {
    source_paths
        .iter()
        .map(|source| path_size(Path::new(source)))
        .sum()
}

/// Velocidad promedio simple y estable: bytes sobre segundos desde el arranque,
/// truncada a `u64`. 0 cuando el tiempo es ~0 (evita dividir por cero).
pub(crate) fn bytes_per_second(bytes: u64, elapsed_secs: f64) -> u64 {
    if elapsed_secs > 0.0 {
        (bytes as f64 / elapsed_secs) as u64
    } else {
        0
    }
}

/// Copia un archivo en chunks de 1 MiB reportando por `on_bytes` los bytes que va
/// escribiendo, con chequeo de cancelación **entre chunks**. Conserva el modo del
/// original, como hacía `fs::copy`. Expuesta para poder probar la copia con
/// callback sin montar Tauri.
pub(crate) fn copy_file_counting(
    source: &Path,
    dest: &Path,
    cancel: Option<&Arc<AtomicBool>>,
    on_bytes: &mut dyn FnMut(u64),
) -> Result<(), String> {
    let metadata = fs::metadata(source).map_err(|error| error.to_string())?;
    let mut reader = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut writer = fs::File::create(dest).map_err(|error| error.to_string())?;
    let mut buffer = vec![0u8; 1024 * 1024];

    loop {
        if cancel.is_some_and(|t| t.load(Ordering::SeqCst)) {
            return Err("Operation cancelled".to_string());
        }
        let read = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|error| error.to_string())?;
        on_bytes(read as u64);
    }

    // `fs::copy` copiaba el modo; con la copia manual hay que replicarlo.
    fs::set_permissions(dest, metadata.permissions()).map_err(|error| error.to_string())?;
    Ok(())
}

/// Emisor de progreso de copia con throttle y acumulador de bytes. Un único
/// evento cada `PROGRESS_THROTTLE` como mucho (o `force`), con la velocidad
/// promedio calculada en el momento.
struct CopyProgress<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    id: &'a Option<String>,
    total: usize,
    total_bytes: u64,
    processed_bytes: AtomicU64,
    start: Instant,
    last_emit: Cell<Option<Instant>>,
}

impl<'a, R: Runtime> CopyProgress<'a, R> {
    fn new(app: &'a AppHandle<R>, id: &'a Option<String>, total: usize, total_bytes: u64) -> Self {
        CopyProgress {
            app,
            id,
            total,
            total_bytes,
            processed_bytes: AtomicU64::new(0),
            start: Instant::now(),
            last_emit: Cell::new(None),
        }
    }

    /// Suma bytes al acumulador y devuelve el nuevo total.
    fn add_bytes(&self, delta: u64) -> u64 {
        self.processed_bytes.fetch_add(delta, Ordering::Relaxed) + delta
    }

    fn bytes(&self) -> u64 {
        self.processed_bytes.load(Ordering::Relaxed)
    }

    /// Emite si pasaron ≥ `PROGRESS_THROTTLE` desde el último evento (o `force`).
    /// `processed_bytes` se pasa explícito para que el evento final pueda llegar a
    /// `total_bytes` aunque el acumulador se quede corto por omisiones o fallos.
    fn emit(&self, processed: usize, current: &str, processed_bytes: u64, force: bool) {
        let Some(id) = self.id else {
            return;
        };
        let now = Instant::now();
        let due = force
            || self
                .last_emit
                .get()
                .is_none_or(|last| now.duration_since(last) >= PROGRESS_THROTTLE);
        if !due {
            return;
        }
        self.last_emit.set(Some(now));

        let bps = bytes_per_second(processed_bytes, self.start.elapsed().as_secs_f64());
        let _ = self.app.emit(
            "file-operation-progress",
            OperationProgress {
                operation_id: id.clone(),
                kind: "copy".to_string(),
                processed,
                total: self.total,
                current: current.to_string(),
                processed_bytes,
                total_bytes: self.total_bytes,
                bytes_per_second: bps,
            },
        );
    }
}

/// ¿El destino vive en una unidad removible? Busca el montaje más específico que
/// contiene la ruta y devuelve su flag de removible. Ante la duda, `false`: el
/// flush extra sólo hace falta donde retirar la unidad en caliente pierde datos.
fn destination_is_removable(destination: &Path) -> bool {
    use sysinfo::Disks;
    let target = destination
        .canonicalize()
        .unwrap_or_else(|_| destination.to_path_buf());
    Disks::new_with_refreshed_list()
        .iter()
        .filter(|disk| target.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .is_some_and(|disk| disk.is_removable())
}

/// Baja a disco el filesystem entero del directorio con `syncfs`. Devuelve el
/// error del sistema si no se pudo abrir el directorio o si la bajada falla.
fn sync_filesystem(directory: &Path) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    let dir = fs::File::open(directory)?;
    if unsafe { libc::syncfs(dir.as_raw_fd()) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

/// Antes de avisar que la operación terminó, fuerza a disco lo que se escribió
/// en el destino si vive en una unidad removible. En un USB el «listo» puede
/// llegar con datos todavía en la caché del kernel; si se retira ahí, se pierden.
/// Sólo en removibles, para no penalizar las copias a disco interno; mejor
/// esfuerzo: si falla, no hay nada mejor que avisar igual.
fn flush_if_removable(destination: &Path) {
    if !destination_is_removable(destination) {
        return;
    }
    if let Err(error) = sync_filesystem(destination) {
        log::warn!(
            "No se pudo bajar a disco la unidad removible {}: {error}",
            destination.display()
        );
    }
}

/// El flush de cierre de una operación: sólo si realmente se escribió algo. Un
/// `move` que no movió nada, o un `copy` sin copias, no tocó el disco y no hay
/// nada que bajar. Separado del comando para poder probar la compuerta sin un
/// `AppHandle` de por medio.
fn flush_after_write(wrote_something: bool, destination: &Path) {
    if wrote_something {
        flush_if_removable(destination);
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
    on_bytes: &mut dyn FnMut(u64),
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
            copy_dir_recursive(&source_path, &dest_path, cancel, on_bytes)?;
        } else {
            copy_file_counting(&source_path, &dest_path, cancel, on_bytes)?;
        }
    }

    Ok(())
}

/// Copia un archivo o una carpeta sin privilegios, reportando por `on_bytes` los
/// bytes que avanza.
fn copy_unprivileged(
    source: &Path,
    dest_path: &Path,
    cancel: Option<&Arc<AtomicBool>>,
    on_bytes: &mut dyn FnMut(u64),
) -> Result<(), String> {
    if source.is_dir() {
        copy_dir_recursive(source, dest_path, cancel, on_bytes)
    } else {
        copy_file_counting(source, dest_path, cancel, on_bytes)
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
    unique_destination_avoiding(destination, name, &[])
}

/// Una ruta libre en `destination`, que además no es la de nada que esta operación
/// ya reservó para la elevación (todavía no está en el disco).
fn unique_destination_avoiding(
    destination: &Path,
    name: &str,
    reserved: &[PendingCopy],
) -> std::path::PathBuf {
    let taken = |path: &Path| path.exists() || reserved.iter().any(|item| item.dest_path == path);
    let mut dest_path = destination.join(name);
    let mut counter = 1;

    while taken(&dest_path) {
        let path = Path::new(name);
        let stem = path
            .file_stem()
            .and_then(std::ffi::OsStr::to_str)
            .unwrap_or(name);
        let extension = path.extension().and_then(std::ffi::OsStr::to_str);

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

/// Qué hacer con el destino de una cosa a copiar.
enum Destination {
    /// Resolución «omitir» ante un conflicto: no se copia.
    Skip,
    /// Se copia a `path`. `remove_first`: hay algo en el disco que borrar antes
    /// («reemplazar»). `dropped`: cuántas cosas ya reservadas para esa ruta se
    /// descartaron porque ésta las reemplaza.
    Copy {
        path: PathBuf,
        remove_first: bool,
        dropped: u32,
    },
}

/// Resuelve el destino de una cosa según la resolución elegida.
///
/// Un conflicto es una ruta que existe en el disco **o** que ya reservó otra cosa de
/// esta misma operación a la espera de la elevación: dos orígenes con el mismo nombre
/// (resultados de una búsqueda, por ejemplo) hacia un destino que pide privilegios
/// quedaban con la misma ruta, y el segundo pisaba al primero sin avisar.
fn plan_destination(
    destination: &Path,
    file_name: &str,
    is_same_directory: bool,
    resolution: &ConflictResolution,
    pending: &mut Vec<PendingCopy>,
) -> Destination {
    let free = |path: PathBuf, remove_first, dropped| Destination::Copy {
        path,
        remove_first,
        dropped,
    };
    if is_same_directory {
        return free(
            unique_destination_avoiding(destination, file_name, pending),
            false,
            0,
        );
    }

    let initial = destination.join(file_name);
    let on_disk = initial.exists();
    let reserved = pending.iter().any(|item| item.dest_path == initial);
    if !on_disk && !reserved {
        return free(initial, false, 0);
    }

    match resolution {
        ConflictResolution::Skip => Destination::Skip,
        ConflictResolution::AutoRename => free(
            unique_destination_avoiding(destination, file_name, pending),
            false,
            0,
        ),
        ConflictResolution::Replace => {
            // Lo reservado nunca llegó al disco: reemplazarlo es no copiarlo.
            let before = pending.len();
            pending.retain(|item| item.dest_path != initial);
            let dropped = (before - pending.len()) as u32;
            free(initial, on_disk, dropped)
        }
    }
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

/// Borra un archivo o una carpeta sin privilegios.
fn remove_unprivileged(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn remove_dir_or_file(path: &Path) -> Result<(), String> {
    match remove_unprivileged(path) {
        Err(error) if polkit::is_permission_denied(&error) => polkit::remove_with_pkexec(path),
        result => result,
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
    copy_items_impl(
        source_paths,
        destination_path,
        conflict_resolution,
        operation_id,
        app,
    )
}

/// Núcleo genérico sobre el runtime para poder ejercitar la copia bajo el mock de
/// Tauri (`tauri::test::mock_app()`); el comando concreto sólo delega.
pub(crate) fn copy_items_impl<R: Runtime>(
    source_paths: Vec<String>,
    destination_path: String,
    conflict_resolution: Option<String>,
    operation_id: Option<String>,
    app: AppHandle<R>,
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

    // Progreso por bytes: se precalcula el total y se acumula lo copiado, con los
    // eventos throttleados para no inundar el bridge de Tauri.
    let total_bytes = total_source_bytes(&source_paths);
    let progress = CopyProgress::new(&app, &operation_id, total, total_bytes);

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
        progress.emit(index, source_path_str, progress.bytes(), false);

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

        let (dest_path, replaced_existing) = match plan_destination(
            destination,
            &file_name,
            is_same_directory,
            &resolution,
            &mut pending,
        ) {
            Destination::Skip => {
                skipped_count += 1;
                continue;
            }
            Destination::Copy {
                path,
                remove_first,
                dropped,
            } => {
                // Lo reservado que éste reemplaza no se copia: cuenta como omitido.
                skipped_count += dropped;
                if remove_first {
                    if let Err(error) = remove_dir_or_file(&path) {
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
                }
                (path, remove_first)
            }
        };

        let mut on_bytes = |delta: u64| {
            let done = progress.add_bytes(delta);
            progress.emit(index, source_path_str, done, false);
        };
        match copy_unprivileged(source, &dest_path, token.as_ref(), &mut on_bytes) {
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
                    // El camino elevado (pkexec/cp) no mide por bytes: cuando un
                    // item termina OK se suma su tamaño precalculado de golpe.
                    let done = progress.add_bytes(path_size(&item.source));
                    progress.emit(copied_count as usize, "", done, false);
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

    flush_after_write(copied_count > 0, destination);
    // Evento final: la barra tiene que llegar a 100% aunque haya habido omisiones
    // o fallos, así que se fuerza `processed_bytes == total_bytes`.
    progress.emit(total, "", total_bytes, true);
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
    move_items_impl(
        source_paths,
        destination_path,
        conflict_resolution,
        operation_id,
        app,
    )
}

/// Núcleo genérico sobre el runtime; el comando concreto sólo delega (ver
/// `copy_items_impl`).
pub(crate) fn move_items_impl<R: Runtime>(
    source_paths: Vec<String>,
    destination_path: String,
    conflict_resolution: Option<String>,
    operation_id: Option<String>,
    app: AppHandle<R>,
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

    let total = source_paths.len();
    let token = operation_id.as_ref().map(|id| register_operation(id));

    let report = move_paths(
        &source_paths,
        destination,
        &resolution,
        &token,
        &|index, current| emit_progress(&app, &operation_id, "move", index, total, current),
    );

    flush_after_write(!report.moved_pairs.is_empty(), destination);
    emit_progress(&app, &operation_id, "move", total, total, "");
    if let Some(id) = &operation_id {
        unregister_operation(id);
    }

    undo::push(
        "move",
        report.moved_pairs.len(),
        report.partial_undo,
        undo::UndoAction::MoveBack {
            pairs: report.moved_pairs,
        },
    );

    FileOperationResult {
        success: report.failed == 0,
        error: report.last_error,
        copied_count: Some(report.moved),
        failed_count: Some(report.failed),
        skipped_count: Some(report.skipped),
    }
}

/// Lo que no se pudo mover sin privilegios y espera la elevación de la operación.
struct PendingMove {
    source: PathBuf,
    dest_path: PathBuf,
    /// Hay algo en `dest_path` que borrar antes («reemplazar»), y tampoco se pudo
    /// sin privilegios.
    remove_first: bool,
    /// Lo que había en `dest_path` ya no está: no se deshace.
    replaced_existing: bool,
    /// Entre dispositivos: ya se copió sin privilegios y sólo falta borrar el
    /// original.
    copied: bool,
}

/// Cómo terminó mover una cosa sin privilegios.
enum MoveStep {
    Done,
    NeedsElevation { copied: bool },
    Failed(String),
}

/// Mover entre dispositivos es copiar y borrar el original.
fn move_across_devices(
    source: &Path,
    dest_path: &Path,
    cancel: Option<&Arc<AtomicBool>>,
) -> MoveStep {
    let existed = dest_path.exists();
    // Mover sigue informando por archivos: la copia interna no reporta bytes.
    match copy_unprivileged(source, dest_path, cancel, &mut |_| {}) {
        Ok(()) => match remove_unprivileged(source) {
            Err(error) if polkit::is_permission_denied(&error) => {
                MoveStep::NeedsElevation { copied: true }
            }
            // Que no se pueda borrar el original no deshace la copia.
            _ => MoveStep::Done,
        },
        Err(error) if polkit::is_permission_denied(&error) => {
            // Lo que quedó a medias lo creamos nosotros: `mv` no entra en una
            // carpeta que ya existe.
            if !existed {
                let _ = remove_unprivileged(dest_path);
            }
            MoveStep::NeedsElevation { copied: false }
        }
        Err(error) => MoveStep::Failed(error),
    }
}

/// Mueve con privilegios lo que no se pudo mover sin ellos, pidiendo la contraseña
/// **una vez** para todo lo que va con su mismo nombre adentro de `destination` (y
/// para borrar lo que reemplaza o los originales ya copiados), y una vez más sólo
/// por cada cosa que cambió de nombre por un conflicto, que es raro. Si la persona
/// rechaza la primera no se vuelve a pedir.
///
/// Devuelve un resultado por elemento, en el mismo orden. Si `mv` falla a mitad no
/// se sabe, por la salida, cuáles quedaron hechas: se mira el disco, y sólo cuenta
/// como movido lo que ya no está en el origen y sí en el destino.
fn move_pending_elevated(
    pending: &[PendingMove],
    destination: &Path,
    elevation: &polkit::Elevation,
) -> Vec<Result<(), String>> {
    let mut results: Vec<Option<Result<(), String>>> = vec![None; pending.len()];

    let batch: Vec<usize> = (0..pending.len())
        .filter(|&i| {
            let item = &pending[i];
            item.copied
                || (item.dest_path.parent() == Some(destination)
                    && item.dest_path.file_name() == item.source.file_name())
        })
        .collect();
    if !batch.is_empty() {
        let removals: Vec<&Path> = batch
            .iter()
            .filter_map(|&i| {
                let item = &pending[i];
                if item.copied {
                    Some(item.source.as_path())
                } else if item.remove_first {
                    Some(item.dest_path.as_path())
                } else {
                    None
                }
            })
            .collect();
        let sources: Vec<&Path> = batch
            .iter()
            .filter(|&&i| !pending[i].copied)
            .map(|&i| pending[i].source.as_path())
            .collect();
        let outcome =
            elevation.attempt(|| polkit::move_into_with_pkexec(&removals, &sources, destination));
        for &i in &batch {
            results[i] = Some(match &outcome {
                Err(error) if !polkit::is_auth_refused(error) => {
                    let item = &pending[i];
                    let done = !item.source.exists() && (item.copied || item.dest_path.exists());
                    if done {
                        Ok(())
                    } else {
                        Err(error.clone())
                    }
                }
                outcome => outcome.clone(),
            });
        }
    }

    for (i, item) in pending.iter().enumerate() {
        if results[i].is_none() {
            results[i] =
                Some(elevation.attempt(|| polkit::move_with_pkexec(&item.source, &item.dest_path)));
        }
    }

    results.into_iter().flatten().collect()
}

/// Lo que dejó un movimiento.
struct MoveReport {
    moved: u32,
    failed: u32,
    skipped: u32,
    last_error: Option<String>,
    /// (destino, original) de lo que de verdad se movió, para deshacer.
    moved_pairs: Vec<(PathBuf, PathBuf)>,
    partial_undo: bool,
}

/// Mueve cada cosa a `destination`, sin saber de la ventana: `progress` avisa por
/// cuál va.
fn move_paths(
    source_paths: &[String],
    destination: &Path,
    resolution: &ConflictResolution,
    token: &Option<Arc<AtomicBool>>,
    progress: &dyn Fn(usize, &str),
) -> MoveReport {
    let mut moved_count: u32 = 0;
    let mut failed_count: u32 = 0;
    let mut skipped_count: u32 = 0;
    let mut last_error: Option<String> = None;

    // Lo que necesita privilegios se junta y se eleva una sola vez al final: una
    // contraseña por operación, no una por cosa.
    let elevation = polkit::Elevation::new();
    let mut pending: Vec<PendingMove> = Vec::new();

    // Undo bookkeeping: (destination, original) pairs to move back.
    let mut moved_pairs: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut partial_undo = false;

    for (index, source_path_str) in source_paths.iter().enumerate() {
        if is_cancelled(token) {
            break;
        }
        progress(index, source_path_str);

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
                ConflictResolution::Replace => match remove_unprivileged(&dest_path) {
                    Ok(()) => {
                        replaced_existing = true;
                        dest_path
                    }
                    Err(error) if polkit::is_permission_denied(&error) => {
                        // Borrar lo que hay también pide privilegios: va con el
                        // movimiento, en la misma llamada.
                        pending.push(PendingMove {
                            source: source.to_path_buf(),
                            dest_path,
                            remove_first: true,
                            replaced_existing: true,
                            copied: false,
                        });
                        continue;
                    }
                    Err(error) => {
                        failed_count += 1;
                        last_error = Some(error);
                        continue;
                    }
                },
                ConflictResolution::AutoRename => {
                    get_unique_destination_path(destination, &file_name)
                }
            }
        } else {
            dest_path
        };

        let step = match fs::rename(source, &final_dest_path) {
            Ok(()) => MoveStep::Done,
            Err(error) if matches!(error.raw_os_error(), Some(17) | Some(18)) => {
                move_across_devices(source, &final_dest_path, token.as_ref())
            }
            Err(error) if polkit::is_permission_denied(&error.to_string()) => {
                MoveStep::NeedsElevation { copied: false }
            }
            Err(error) => MoveStep::Failed(error.to_string()),
        };

        match step {
            MoveStep::Done => {
                moved_count += 1;

                if replaced_existing {
                    // Moving back would leave nothing where the replaced file
                    // was, and that file is unrecoverable — skip it.
                    partial_undo = true;
                } else {
                    moved_pairs.push((final_dest_path, source.to_path_buf()));
                }
            }
            MoveStep::NeedsElevation { copied } => pending.push(PendingMove {
                source: source.to_path_buf(),
                dest_path: final_dest_path,
                remove_first: false,
                replaced_existing,
                copied,
            }),
            MoveStep::Failed(error) => {
                failed_count += 1;
                last_error = Some(error);
            }
        }
    }

    if !pending.is_empty() {
        let results = if is_cancelled(token) {
            vec![Err("Operation cancelled".to_string()); pending.len()]
        } else {
            move_pending_elevated(&pending, destination, &elevation)
        };
        for (item, result) in pending.into_iter().zip(results) {
            match result {
                Ok(()) => {
                    moved_count += 1;
                    if item.replaced_existing {
                        partial_undo = true;
                    } else {
                        moved_pairs.push((item.dest_path, item.source));
                    }
                }
                Err(error) => {
                    failed_count += 1;
                    last_error = Some(error);
                }
            }
        }
    }

    MoveReport {
        moved: moved_count,
        failed: failed_count,
        skipped: skipped_count,
        last_error,
        moved_pairs,
        partial_undo,
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
    delete_items_impl(paths, use_trash, operation_id, allow_elevation, app)
}

/// Núcleo genérico sobre el runtime; el comando concreto sólo delega (ver
/// `copy_items_impl`).
pub(crate) fn delete_items_impl<R: Runtime>(
    paths: Vec<String>,
    use_trash: bool,
    operation_id: Option<String>,
    allow_elevation: Option<bool>,
    app: AppHandle<R>,
) -> FileOperationResult {
    let allow_elevation = allow_elevation.unwrap_or(true);
    let total = paths.len();
    let token = operation_id.as_ref().map(|id| register_operation(id));
    let deleted_after = now_secs();

    let report = delete_paths(
        &paths,
        use_trash,
        allow_elevation,
        &token,
        &|index, current| emit_progress(&app, &operation_id, "delete", index, total, current),
    );

    emit_progress(&app, &operation_id, "delete", total, total, "");
    if let Some(id) = &operation_id {
        unregister_operation(id);
    }

    undo::push(
        "delete",
        report.trashed.len(),
        false,
        undo::UndoAction::RestoreFromTrash {
            paths: report.trashed,
            deleted_after,
        },
    );

    FileOperationResult {
        success: report.failed == 0,
        error: report.last_error,
        copied_count: Some(report.deleted),
        failed_count: Some(report.failed),
        skipped_count: Some(0),
    }
}

/// Borra con privilegios lo que no se pudo borrar sin ellos, pidiendo la contraseña
/// **una vez** para todo. Devuelve un resultado por ruta, en el mismo orden; si
/// `rm` falla a mitad no se sabe cuáles quedaron hechas, así que se mira el disco.
fn delete_pending_elevated(
    pending: &[PathBuf],
    elevation: &polkit::Elevation,
) -> Vec<Result<(), String>> {
    let paths: Vec<&Path> = pending.iter().map(PathBuf::as_path).collect();
    let outcome = elevation.attempt(|| polkit::remove_many_with_pkexec(&paths));
    pending
        .iter()
        .map(|path| match &outcome {
            Err(error) if !polkit::is_auth_refused(error) && !path.exists() => Ok(()),
            outcome => outcome.clone(),
        })
        .collect()
}

/// Lo que dejó un borrado.
struct DeleteReport {
    deleted: u32,
    failed: u32,
    last_error: Option<String>,
    /// Sólo lo que llegó a la papelera se puede restaurar; un borrado definitivo no se deshace.
    trashed: Vec<PathBuf>,
}

/// Borra o manda a la papelera cada ruta, sin saber de la ventana: `progress` avisa
/// por cuál va.
fn delete_paths(
    paths: &[String],
    use_trash: bool,
    allow_elevation: bool,
    token: &Option<Arc<AtomicBool>>,
    progress: &dyn Fn(usize, &str),
) -> DeleteReport {
    let mut deleted_count: u32 = 0;
    let mut failed_count: u32 = 0;
    let mut last_error: Option<String> = None;

    // Sólo lo que llegó a la papelera se puede restaurar.
    let mut trashed: Vec<PathBuf> = Vec::new();
    // Lo que necesita privilegios se junta y se borra de una vez al final.
    let mut pending: Vec<PathBuf> = Vec::new();

    for (index, path_str) in paths.iter().enumerate() {
        if is_cancelled(token) {
            break;
        }
        progress(index, path_str);

        let path = Path::new(path_str);

        if !path.exists() {
            failed_count += 1;
            last_error = Some(format!("Path does not exist: {}", path_str));
            continue;
        }

        let attempt = if use_trash {
            trash::delete(path)
                .map(|()| true)
                .map_err(|error| error.to_string())
        } else {
            remove_unprivileged(path).map(|()| false)
        };

        match attempt {
            Ok(reached_trash) => {
                deleted_count += 1;
                if reached_trash {
                    trashed.push(path.to_path_buf());
                }
            }
            // Un borrado definitivo lo pidió la persona; mandar a la papelera, en
            // cambio, sólo se eleva si `allow_elevation` lo permite. Se junta y se
            // eleva una vez al final.
            Err(error)
                if (allow_elevation || !use_trash) && polkit::is_permission_denied(&error) =>
            {
                pending.push(path.to_path_buf());
            }
            Err(error) => {
                failed_count += 1;
                last_error = Some(error);
            }
        }
    }

    if !pending.is_empty() {
        let results = if is_cancelled(token) {
            vec![Err("Operation cancelled".to_string()); pending.len()]
        } else {
            delete_pending_elevated(&pending, &polkit::Elevation::new())
        };
        for result in results {
            match result {
                Ok(()) => deleted_count += 1,
                Err(error) => {
                    failed_count += 1;
                    last_error = Some(error);
                }
            }
        }
    }

    DeleteReport {
        deleted: deleted_count,
        failed: failed_count,
        last_error,
        trashed,
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
    use std::os::unix::fs::PermissionsExt;

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

        let result = copy_dir_recursive(&source, &root.join("origen"), None, &mut |_| {});

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
            match copy_unprivileged(source, &dest_path, None, &mut |_| {}) {
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

    fn reserved(destination: &Path, name: &str) -> PendingCopy {
        PendingCopy {
            source: PathBuf::from("/origen-otro").join(name),
            dest_path: destination.join(name),
            replaced_existing: false,
        }
    }

    fn copy_path(planned: Destination) -> PathBuf {
        match planned {
            Destination::Copy { path, .. } => path,
            Destination::Skip => panic!("se esperaba una copia"),
        }
    }

    #[test]
    fn dos_origenes_con_el_mismo_nombre_no_quedan_con_la_misma_ruta() {
        // Con el destino pidiendo privilegios la primera queda reservada y no está
        // en el disco: sin contarla, la segunda tomaba la misma ruta y `cp` la
        // pisaba sin avisar.
        let dir = scratch("conflicto-reservado");
        let mut pending = vec![reserved(&dir, "foto.png")];
        // Lo que pasaba: mirando sólo el disco, la segunda tomaba la misma ruta.
        assert_eq!(
            get_unique_destination_path(&dir, "foto.png"),
            pending[0].dest_path
        );

        let second = copy_path(plan_destination(
            &dir,
            "foto.png",
            false,
            &ConflictResolution::AutoRename,
            &mut pending,
        ));

        assert_eq!(second, dir.join("foto (1).png"));
        pending.push(PendingCopy {
            source: PathBuf::from("/otro/foto.png"),
            dest_path: second,
            replaced_existing: false,
        });
        let third = copy_path(plan_destination(
            &dir,
            "foto.png",
            false,
            &ConflictResolution::AutoRename,
            &mut pending,
        ));
        assert_eq!(third, dir.join("foto (2).png"));
        cleanup(&dir);
    }

    #[test]
    fn omitir_tambien_omite_lo_que_ya_estaba_reservado() {
        let dir = scratch("omitir-reservado");
        let mut pending = vec![reserved(&dir, "foto.png")];

        let planned = plan_destination(
            &dir,
            "foto.png",
            false,
            &ConflictResolution::Skip,
            &mut pending,
        );

        assert!(matches!(planned, Destination::Skip));
        assert_eq!(pending.len(), 1, "lo ya reservado se conserva");
        cleanup(&dir);
    }

    #[test]
    fn reemplazar_lo_reservado_descarta_el_anterior_y_no_borra_nada_del_disco() {
        let dir = scratch("reemplazar-reservado");
        let mut pending = vec![reserved(&dir, "foto.png"), reserved(&dir, "otra.png")];

        let planned = plan_destination(
            &dir,
            "foto.png",
            false,
            &ConflictResolution::Replace,
            &mut pending,
        );

        match planned {
            Destination::Copy {
                path,
                remove_first,
                dropped,
            } => {
                assert_eq!(path, dir.join("foto.png"));
                // No hay nada en el disco que borrar: mandar a `rm` una ruta que
                // sólo existe en la cola pedía la contraseña para nada.
                assert!(!remove_first);
                assert_eq!(dropped, 1);
            }
            Destination::Skip => panic!("se esperaba una copia"),
        }
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].dest_path, dir.join("otra.png"));
        cleanup(&dir);
    }

    #[test]
    fn un_conflicto_en_el_disco_se_resuelve_como_siempre() {
        let dir = scratch("conflicto-en-disco");
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        let mut pending = Vec::new();

        let replace = plan_destination(
            &dir,
            "a.txt",
            false,
            &ConflictResolution::Replace,
            &mut pending,
        );
        assert!(matches!(
            replace,
            Destination::Copy {
                remove_first: true,
                dropped: 0,
                ..
            }
        ));

        let renamed = copy_path(plan_destination(
            &dir,
            "a.txt",
            false,
            &ConflictResolution::AutoRename,
            &mut pending,
        ));
        assert_eq!(renamed, dir.join("a (1).txt"));

        let skipped = plan_destination(
            &dir,
            "a.txt",
            false,
            &ConflictResolution::Skip,
            &mut pending,
        );
        assert!(matches!(skipped, Destination::Skip));
        cleanup(&dir);
    }

    #[test]
    fn sin_conflicto_va_al_nombre_de_siempre_y_en_la_misma_carpeta_se_renombra() {
        let dir = scratch("sin-conflicto");
        let mut pending = Vec::new();

        let free = plan_destination(
            &dir,
            "nuevo.txt",
            false,
            &ConflictResolution::Skip,
            &mut pending,
        );
        assert!(matches!(
            free,
            Destination::Copy {
                remove_first: false,
                dropped: 0,
                ..
            }
        ));
        assert_eq!(copy_path(free), dir.join("nuevo.txt"));

        // Copiar una cosa sobre su propia carpeta nunca pisa: siempre se renombra.
        std::fs::write(dir.join("nuevo.txt"), b"x").unwrap();
        let same_dir = copy_path(plan_destination(
            &dir,
            "nuevo.txt",
            true,
            &ConflictResolution::Replace,
            &mut pending,
        ));
        assert_eq!(same_dir, dir.join("nuevo (1).txt"));
        cleanup(&dir);
    }

    /// Un destino «de root» (sin permiso de escritura) y tres cosas para mover:
    /// un archivo, una carpeta con contenido y otro archivo.
    fn move_scenario(name: &str) -> (PathBuf, PathBuf, Vec<String>) {
        let dir = scratch(name);
        let folder = source_tree(&dir, 2);
        let file_a = dir.join("uno.txt");
        let file_b = dir.join("dos.txt");
        std::fs::write(&file_a, b"1").unwrap();
        std::fs::write(&file_b, b"2").unwrap();
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(&root).unwrap();
        make_read_only(&root);
        let sources = [&file_a, &folder, &file_b]
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        (dir, root, sources)
    }

    fn run_move(sources: &[String], root: &Path, resolution: ConflictResolution) -> MoveReport {
        move_paths(sources, root, &resolution, &None, &|_, _| {})
    }

    #[test]
    fn mover_varias_cosas_a_un_destino_sin_permiso_pide_la_contrasena_una_sola_vez() {
        if running_as_root() {
            return;
        }
        let (dir, root, sources) = move_scenario("mover-una-vez");
        let log = install_authorizing(&dir, &root);

        let report = run_move(&sources, &root, ConflictResolution::Skip);

        // Antes eran tres: un `mv` por cada cosa, y cada uno pedía la contraseña.
        assert_eq!(invocations(&log).len(), 1, "{:?}", invocations(&log));
        assert_eq!((report.moved, report.failed, report.skipped), (3, 0, 0));
        assert!(root.join("uno.txt").is_file());
        assert!(root.join("dos.txt").is_file());
        assert!(root.join("origen/sub/b1.txt").is_file());
        assert!(!dir.join("uno.txt").exists());
        assert!(!dir.join("origen").exists());
        // Y se puede deshacer lo que se movió, cosa por cosa.
        assert_eq!(report.moved_pairs.len(), 3);
        assert!(report
            .moved_pairs
            .contains(&(root.join("origen"), dir.join("origen"))));
        assert!(!report.partial_undo);
        cleanup(&dir);
    }

    #[test]
    fn mover_sin_necesidad_de_privilegios_no_pide_nada() {
        let dir = scratch("mover-sin-privilegios");
        let file = dir.join("uno.txt");
        std::fs::write(&file, b"1").unwrap();
        let destination = dir.join("destino-comun");
        std::fs::create_dir_all(&destination).unwrap();
        let log = install_refusing(&dir, 126);

        let report = run_move(
            &[file.to_string_lossy().into_owned()],
            &destination,
            ConflictResolution::Skip,
        );

        assert_eq!(report.moved, 1);
        assert_eq!(invocations(&log), Vec::<String>::new());
        cleanup(&dir);
    }

    #[test]
    fn rechazar_la_contrasena_al_mover_no_la_vuelve_a_pedir_y_no_registra_nada_para_deshacer() {
        if running_as_root() {
            return;
        }
        for code in [126, 127] {
            let (dir, root, sources) = move_scenario(&format!("mover-rechazo-{code}"));
            let log = install_refusing(&dir, code);

            let report = run_move(&sources, &root, ConflictResolution::Skip);

            assert_eq!(
                invocations(&log).len(),
                1,
                "código {code}: {:?}",
                invocations(&log)
            );
            // Las tres se informan como fallidas y siguen donde estaban.
            assert_eq!((report.moved, report.failed), (0, 3));
            assert_eq!(
                report.last_error.as_deref(),
                Some(polkit::AUTH_REFUSED),
                "código {code}"
            );
            assert!(report.moved_pairs.is_empty());
            assert!(dir.join("uno.txt").is_file());
            assert!(dir.join("origen/sub/b1.txt").is_file());
            cleanup(&dir);
        }
    }

    #[test]
    fn reemplazar_al_mover_a_un_destino_sin_permiso_no_pide_la_contrasena_dos_veces() {
        if running_as_root() {
            return;
        }
        let dir = scratch("mover-reemplazar");
        let file = dir.join("uno.txt");
        std::fs::write(&file, b"nuevo").unwrap();
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("uno.txt"), b"viejo").unwrap();
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);

        let report = run_move(
            &[file.to_string_lossy().into_owned()],
            &root,
            ConflictResolution::Replace,
        );

        // Antes: un `rm -rf` para borrar lo que había y otro `mv`, dos contraseñas.
        assert_eq!(invocations(&log).len(), 1, "{:?}", invocations(&log));
        assert_eq!((report.moved, report.failed), (1, 0));
        assert_eq!(std::fs::read(root.join("uno.txt")).unwrap(), b"nuevo");
        assert!(!file.exists());
        // Lo reemplazado no vuelve: no se deshace, y se avisa.
        assert!(report.partial_undo);
        assert!(report.moved_pairs.is_empty());
        cleanup(&dir);
    }

    #[test]
    fn un_conflicto_renombrado_al_mover_va_con_su_nombre_nuevo() {
        if running_as_root() {
            return;
        }
        let dir = scratch("mover-renombrar");
        let conflicting = dir.join("uno.txt");
        let other = dir.join("dos.txt");
        std::fs::write(&conflicting, b"nuevo").unwrap();
        std::fs::write(&other, b"2").unwrap();
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("uno.txt"), b"viejo").unwrap();
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);

        let report = run_move(
            &[
                conflicting.to_string_lossy().into_owned(),
                other.to_string_lossy().into_owned(),
            ],
            &root,
            ConflictResolution::AutoRename,
        );

        // Una llamada para lo que conserva su nombre y otra por lo renombrado.
        assert_eq!(invocations(&log).len(), 2, "{:?}", invocations(&log));
        assert_eq!((report.moved, report.failed), (2, 0));
        assert_eq!(std::fs::read(root.join("uno.txt")).unwrap(), b"viejo");
        assert_eq!(std::fs::read(root.join("uno (1).txt")).unwrap(), b"nuevo");
        assert!(root.join("dos.txt").is_file());
        assert!(report
            .moved_pairs
            .contains(&(root.join("uno (1).txt"), conflicting.clone())));
        cleanup(&dir);
    }

    fn run_delete(paths: &[PathBuf]) -> DeleteReport {
        let paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        delete_paths(&paths, false, true, &None, &|_, _| {})
    }

    /// Un directorio «de root» con un archivo, una carpeta con contenido y otro
    /// archivo adentro.
    fn delete_scenario(name: &str) -> (PathBuf, PathBuf, Vec<PathBuf>) {
        let dir = scratch(name);
        let root = dir.join("de-root");
        std::fs::create_dir_all(root.join("carpeta/sub")).unwrap();
        std::fs::write(root.join("uno.txt"), b"1").unwrap();
        std::fs::write(root.join("dos.txt"), b"2").unwrap();
        std::fs::write(root.join("carpeta/a.txt"), b"a").unwrap();
        std::fs::write(root.join("carpeta/sub/b.txt"), b"b").unwrap();
        make_read_only(&root.join("carpeta/sub"));
        make_read_only(&root.join("carpeta"));
        make_read_only(&root);
        let paths = vec![
            root.join("uno.txt"),
            root.join("carpeta"),
            root.join("dos.txt"),
        ];
        (dir, root, paths)
    }

    #[test]
    fn borrar_varias_cosas_sin_permiso_pide_la_contrasena_una_sola_vez() {
        if running_as_root() {
            return;
        }
        let (dir, root, paths) = delete_scenario("borrar-una-vez");
        let log = install_authorizing(&dir, &root);

        let report = run_delete(&paths);

        // Antes eran tres: un `rm -rf` por cada cosa.
        assert_eq!(invocations(&log).len(), 1, "{:?}", invocations(&log));
        assert_eq!((report.deleted, report.failed), (3, 0));
        assert!(paths.iter().all(|p| !p.exists()));
        // Un borrado definitivo no se deshace.
        assert!(report.trashed.is_empty());
        cleanup(&dir);
    }

    #[test]
    fn borrar_sin_necesidad_de_privilegios_no_pide_nada() {
        let dir = scratch("borrar-sin-privilegios");
        let file = dir.join("uno.txt");
        std::fs::write(&file, b"1").unwrap();
        let log = install_refusing(&dir, 126);

        let report = run_delete(std::slice::from_ref(&file));

        assert_eq!(report.deleted, 1);
        assert!(!file.exists());
        assert_eq!(invocations(&log), Vec::<String>::new());
        cleanup(&dir);
    }

    #[test]
    fn rechazar_la_contrasena_al_borrar_no_la_vuelve_a_pedir() {
        if running_as_root() {
            return;
        }
        for code in [126, 127] {
            let (dir, root, paths) = delete_scenario(&format!("borrar-rechazo-{code}"));
            let log = install_refusing(&dir, code);

            let report = run_delete(&paths);

            assert_eq!(
                invocations(&log).len(),
                1,
                "código {code}: {:?}",
                invocations(&log)
            );
            assert_eq!((report.deleted, report.failed), (0, 3));
            assert_eq!(report.last_error.as_deref(), Some(polkit::AUTH_REFUSED));
            assert!(paths.iter().all(|p| p.exists()));
            let _ = root;
            cleanup(&dir);
        }
    }

    #[test]
    fn si_mv_falla_a_mitad_solo_cuenta_como_movido_lo_que_de_verdad_se_movio() {
        if running_as_root() {
            return;
        }
        let dir = scratch("mover-a-mitad");
        let (kept, gone, also_kept) = (
            dir.join("uno.txt"),
            dir.join("dos.txt"),
            dir.join("tres.txt"),
        );
        std::fs::write(&kept, b"1").unwrap();
        std::fs::write(&also_kept, b"3").unwrap();
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(&root).unwrap();
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);
        let pending: Vec<PendingMove> = [&kept, &gone, &also_kept]
            .iter()
            .map(|source| PendingMove {
                source: (*source).clone(),
                dest_path: root.join(source.file_name().unwrap()),
                remove_first: false,
                replaced_existing: false,
                copied: false,
            })
            .collect();

        // `dos.txt` no está: `mv` sigue con las otras y sale con error.
        let results = move_pending_elevated(&pending, &root, &polkit::Elevation::new());

        assert_eq!(invocations(&log).len(), 1);
        assert!(results[0].is_ok());
        assert!(results[1].is_err());
        assert!(results[2].is_ok());
        assert!(root.join("uno.txt").is_file());
        assert!(root.join("tres.txt").is_file());
        cleanup(&dir);
    }

    #[test]
    fn reemplazar_una_carpeta_con_contenido_la_borra_y_mueve_en_una_llamada() {
        if running_as_root() {
            return;
        }
        let dir = scratch("mover-reemplazar-carpeta");
        let folder = source_tree(&dir, 1);
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(root.join("origen/sub")).unwrap();
        std::fs::write(root.join("origen/viejo.txt"), b"v").unwrap();
        make_read_only(&root.join("origen/sub"));
        make_read_only(&root.join("origen"));
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);

        let report = run_move(
            &[folder.to_string_lossy().into_owned()],
            &root,
            ConflictResolution::Replace,
        );

        assert_eq!(invocations(&log).len(), 1, "{:?}", invocations(&log));
        assert_eq!((report.moved, report.failed), (1, 0));
        assert!(root.join("origen/a0.txt").is_file());
        // No se anida ni queda nada de lo que había.
        assert!(!root.join("origen/origen").exists());
        assert!(!root.join("origen/viejo.txt").exists());
        cleanup(&dir);
    }

    #[test]
    fn los_nombres_raros_viajan_como_argumentos_y_no_se_interpretan() {
        if running_as_root() {
            return;
        }
        let dir = scratch("nombres-raros");
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(&root).unwrap();
        let weird = [
            "-n.txt",
            "a b.txt",
            "comi\"lla $HOME `x`.txt",
            "punto;y;coma",
        ];
        for name in weird {
            std::fs::write(root.join(name), b"viejo").unwrap();
            std::fs::write(dir.join(name), b"nuevo").unwrap();
        }
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);
        let sources: Vec<PathBuf> = weird.iter().map(|n| dir.join(n)).collect();
        let dests: Vec<PathBuf> = weird.iter().map(|n| root.join(n)).collect();
        let sources: Vec<&Path> = sources.iter().map(PathBuf::as_path).collect();
        let dests: Vec<&Path> = dests.iter().map(PathBuf::as_path).collect();

        polkit::move_into_with_pkexec(&dests, &sources, &root).unwrap();

        assert_eq!(invocations(&log).len(), 1);
        for name in weird {
            assert_eq!(std::fs::read(root.join(name)).unwrap(), b"nuevo", "{name}");
            assert!(!dir.join(name).exists(), "{name}");
        }
        cleanup(&dir);
    }

    #[test]
    fn entre_dispositivos_el_original_ya_copiado_se_borra_en_la_misma_llamada_que_lo_demas() {
        if running_as_root() {
            return;
        }
        let dir = scratch("mover-copiado");
        let protected = dir.join("origen-de-root");
        std::fs::create_dir_all(&protected).unwrap();
        let copied_source = protected.join("copiado.txt");
        std::fs::write(&copied_source, b"c").unwrap();
        make_read_only(&protected);
        let destination = dir.join("destino-comun");
        std::fs::create_dir_all(&destination).unwrap();
        // Ya se copió sin privilegios; falta borrar el original.
        std::fs::write(destination.join("copiado.txt"), b"c").unwrap();
        let other = dir.join("otro.txt");
        std::fs::write(&other, b"o").unwrap();
        let log = install_authorizing(&dir, &protected);
        let pending = vec![
            PendingMove {
                source: copied_source.clone(),
                dest_path: destination.join("copiado.txt"),
                remove_first: false,
                replaced_existing: false,
                copied: true,
            },
            PendingMove {
                source: other.clone(),
                dest_path: destination.join("otro.txt"),
                remove_first: false,
                replaced_existing: false,
                copied: false,
            },
        ];

        let results = move_pending_elevated(&pending, &destination, &polkit::Elevation::new());

        assert_eq!(results, vec![Ok(()), Ok(())]);
        assert_eq!(invocations(&log).len(), 1, "{:?}", invocations(&log));
        assert!(!copied_source.exists());
        assert!(destination.join("otro.txt").is_file());
        assert!(!other.exists());
        cleanup(&dir);
    }

    #[test]
    fn si_rm_falla_a_mitad_solo_cuenta_como_borrado_lo_que_de_verdad_se_borro() {
        if running_as_root() {
            return;
        }
        let dir = scratch("borrar-a-mitad");
        let root = dir.join("de-root");
        let elsewhere = dir.join("de-otro");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::write(root.join("uno.txt"), b"1").unwrap();
        std::fs::write(elsewhere.join("dos.txt"), b"2").unwrap();
        make_read_only(&root);
        make_read_only(&elsewhere);
        // Este `pkexec` sólo tiene permiso sobre `root`.
        let log = install_authorizing(&dir, &root);
        let pending = vec![root.join("uno.txt"), elsewhere.join("dos.txt")];

        let results = delete_pending_elevated(&pending, &polkit::Elevation::new());

        assert_eq!(invocations(&log).len(), 1);
        assert!(results[0].is_ok());
        assert!(results[1].is_err());
        assert!(!root.join("uno.txt").exists());
        assert!(elsewhere.join("dos.txt").exists());
        cleanup(&dir);
    }

    // El «true» de `destination_is_removable` y la rama removible de
    // `flush_if_removable` necesitan una unidad USB real: no se pueden probar sin
    // hardware. Acá se cubre todo lo que corre en un disco interno.

    #[test]
    fn un_destino_interno_no_se_considera_removible() {
        let dir = scratch("flush-interno");
        assert!(!destination_is_removable(&dir));
        cleanup(&dir);
    }

    #[test]
    fn un_destino_que_no_existe_no_se_considera_removible() {
        let dir = scratch("flush-inexistente");
        assert!(!destination_is_removable(&dir.join("no/existe")));
        cleanup(&dir);
    }

    #[test]
    fn bajar_a_disco_un_directorio_comun_termina_bien() {
        let dir = scratch("flush-sync-ok");
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        // syncfs funciona en cualquier filesystem, no sólo en removibles.
        sync_filesystem(&dir).unwrap();
        cleanup(&dir);
    }

    #[test]
    fn bajar_a_disco_un_directorio_que_no_existe_devuelve_error() {
        let dir = scratch("flush-sync-error");
        let error = sync_filesystem(&dir.join("no-existe")).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
        cleanup(&dir);
    }

    #[test]
    fn el_flush_en_un_destino_interno_no_toca_nada() {
        let dir = scratch("flush-interno-noop");
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        flush_if_removable(&dir);
        assert_eq!(std::fs::read(dir.join("a.txt")).unwrap(), b"x");
        cleanup(&dir);
    }

    // La compuerta no tiene efecto observable en un destino interno (el flush
    // retorna temprano), así que estas pruebas cubren las dos ramas y fijan que
    // ninguna rompe el destino; que flushee de verdad en un USB necesita hardware.

    #[test]
    fn sin_nada_escrito_la_compuerta_del_flush_no_toca_el_destino() {
        let dir = scratch("flush-compuerta-falsa");
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        flush_after_write(false, &dir);
        assert_eq!(std::fs::read(dir.join("a.txt")).unwrap(), b"x");
        cleanup(&dir);
    }

    #[test]
    fn con_algo_escrito_la_compuerta_del_flush_en_un_destino_interno_no_toca_nada() {
        let dir = scratch("flush-compuerta-verdadera");
        std::fs::write(dir.join("a.txt"), b"x").unwrap();
        flush_after_write(true, &dir);
        assert_eq!(std::fs::read(dir.join("a.txt")).unwrap(), b"x");
        cleanup(&dir);
    }

    // --- Progreso por bytes de las copias (#146) ---

    /// Un archivo con contenido que no se repite por chunk, para que una copia
    /// que mezcle o corte un chunk no pase desapercibida.
    fn patterned(len: usize) -> Vec<u8> {
        (0..len).map(|n| (n % 251) as u8).collect()
    }

    #[test]
    fn el_tamano_de_un_archivo_suelto_es_su_largo() {
        let dir = scratch("tamano-archivo");
        let file = dir.join("a.bin");
        std::fs::write(&file, vec![7u8; 1234]).unwrap();
        assert_eq!(path_size(&file), 1234);
        cleanup(&dir);
    }

    #[test]
    fn el_tamano_de_una_carpeta_suma_sus_archivos_y_los_de_las_subcarpetas() {
        let dir = scratch("tamano-carpeta");
        let source = source_tree(&dir, 3);
        // 3 archivos de 1 byte + sub/b1 y sub/b2 de 1 byte; agrego uno anidado más hondo.
        std::fs::create_dir_all(source.join("sub/hondo")).unwrap();
        std::fs::write(source.join("sub/hondo/c.bin"), vec![0u8; 100]).unwrap();
        assert_eq!(path_size(&source), 3 + 2 + 100);
        cleanup(&dir);
    }

    #[test]
    fn una_carpeta_vacia_pesa_cero() {
        let dir = scratch("tamano-vacia");
        assert_eq!(path_size(&dir), 0);
        cleanup(&dir);
    }

    #[test]
    fn el_tamano_no_sigue_los_symlinks_ni_los_cuenta() {
        let dir = scratch("tamano-symlinks");
        let real = dir.join("real");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("grande.bin"), vec![0u8; 5000]).unwrap();
        let tree = dir.join("arbol");
        std::fs::create_dir_all(&tree).unwrap();
        std::fs::write(tree.join("propio.bin"), vec![0u8; 10]).unwrap();
        std::os::unix::fs::symlink(real.join("grande.bin"), tree.join("a-archivo")).unwrap();
        std::os::unix::fs::symlink(&real, tree.join("a-carpeta")).unwrap();

        // Sólo cuenta lo propio: ni el archivo ni la carpeta a los que apuntan.
        assert_eq!(path_size(&tree), 10);
        // Y un symlink pasado directo tampoco se sigue.
        assert_eq!(path_size(&tree.join("a-archivo")), 0);
        assert_eq!(path_size(&tree.join("a-carpeta")), 0);
        cleanup(&dir);
    }

    #[test]
    fn un_symlink_que_apunta_a_su_carpeta_no_cae_en_un_ciclo() {
        let dir = scratch("tamano-ciclo");
        let tree = dir.join("arbol");
        std::fs::create_dir_all(&tree).unwrap();
        std::fs::write(tree.join("a.bin"), vec![0u8; 8]).unwrap();
        std::os::unix::fs::symlink(&tree, tree.join("yo-mismo")).unwrap();
        assert_eq!(path_size(&tree), 8);
        cleanup(&dir);
    }

    #[test]
    fn una_ruta_que_no_existe_pesa_cero() {
        let dir = scratch("tamano-inexistente");
        assert_eq!(path_size(&dir.join("no-esta")), 0);
        cleanup(&dir);
    }

    #[test]
    fn el_total_de_los_origenes_suma_cada_uno() {
        let dir = scratch("total-origenes");
        let file = dir.join("a.bin");
        std::fs::write(&file, vec![0u8; 300]).unwrap();
        let tree = source_tree(&dir, 2); // 2 + 2 bytes
        let sources = vec![
            file.to_string_lossy().into_owned(),
            tree.to_string_lossy().into_owned(),
        ];
        assert_eq!(total_source_bytes(&sources), 304);
        cleanup(&dir);
    }

    #[test]
    fn el_total_de_los_origenes_ignora_los_que_no_existen() {
        let dir = scratch("total-con-faltantes");
        let file = dir.join("a.bin");
        std::fs::write(&file, vec![0u8; 50]).unwrap();
        let sources = vec![
            dir.join("fantasma").to_string_lossy().into_owned(),
            file.to_string_lossy().into_owned(),
        ];
        assert_eq!(total_source_bytes(&sources), 50);
        assert_eq!(total_source_bytes(&[]), 0);
        cleanup(&dir);
    }

    #[test]
    fn la_velocidad_es_bytes_sobre_segundos() {
        assert_eq!(bytes_per_second(1000, 1.0), 1000);
        assert_eq!(bytes_per_second(1000, 2.0), 500);
        assert_eq!(bytes_per_second(10 * 1024 * 1024, 0.5), 20 * 1024 * 1024);
        assert_eq!(bytes_per_second(0, 3.0), 0);
    }

    #[test]
    fn la_velocidad_sin_tiempo_transcurrido_es_cero_y_no_infinita() {
        assert_eq!(bytes_per_second(1_000_000, 0.0), 0);
        assert_eq!(bytes_per_second(1_000_000, -1.0), 0);
    }

    #[test]
    fn la_velocidad_se_trunca_a_un_entero_de_bytes() {
        // 10 / 3 = 3,33…: no sale con decimales ni se va a 4.
        assert_eq!(bytes_per_second(10, 3.0), 3);
        assert_eq!(bytes_per_second(11, 3.0), 3);
        assert_eq!(bytes_per_second(1, 4.0), 0);
    }

    #[test]
    fn copiar_un_archivo_deja_el_mismo_contenido() {
        let dir = scratch("copia-contenido");
        let source = dir.join("origen.bin");
        let dest = dir.join("destino.bin");
        // Más de dos chunks de 1 MiB, con el último a medias.
        let content = patterned(2 * 1024 * 1024 + 12_345);
        std::fs::write(&source, &content).unwrap();

        copy_file_counting(&source, &dest, None, &mut |_| {}).unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), content);
        cleanup(&dir);
    }

    #[test]
    fn lo_que_se_reporta_por_chunk_suma_el_tamano_del_archivo() {
        let dir = scratch("copia-bytes-reportados");
        let source = dir.join("origen.bin");
        let dest = dir.join("destino.bin");
        let len = 2 * 1024 * 1024 + 12_345;
        std::fs::write(&source, patterned(len)).unwrap();

        let mut reports = Vec::new();
        copy_file_counting(&source, &dest, None, &mut |delta| reports.push(delta)).unwrap();

        assert_eq!(reports.iter().sum::<u64>(), len as u64);
        // Reporta mientras copia, no de una sola vez al final: cada chunk es de
        // 1 MiB como mucho.
        assert!(reports.len() >= 3, "{reports:?}");
        assert!(reports.iter().all(|delta| *delta <= 1024 * 1024));
        cleanup(&dir);
    }

    #[test]
    fn copiar_un_archivo_vacio_no_reporta_bytes_y_lo_crea() {
        let dir = scratch("copia-vacia");
        let source = dir.join("origen.txt");
        let dest = dir.join("destino.txt");
        std::fs::write(&source, b"").unwrap();

        let mut calls = 0;
        copy_file_counting(&source, &dest, None, &mut |_| calls += 1).unwrap();

        assert_eq!(calls, 0);
        assert!(dest.exists());
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), 0);
        cleanup(&dir);
    }

    #[test]
    fn la_copia_conserva_el_modo_del_archivo() {
        let dir = scratch("copia-modo");
        for mode in [0o640, 0o755, 0o400] {
            let source = dir.join(format!("origen-{mode:o}"));
            let dest = dir.join(format!("destino-{mode:o}"));
            std::fs::write(&source, b"contenido").unwrap();
            std::fs::set_permissions(&source, std::fs::Permissions::from_mode(mode)).unwrap();

            copy_file_counting(&source, &dest, None, &mut |_| {}).unwrap();

            let copied = std::fs::metadata(&dest).unwrap().permissions().mode() & 0o777;
            assert_eq!(copied, mode, "el modo {mode:o} se tiene que conservar");
        }
        cleanup(&dir);
    }

    #[test]
    fn con_la_cancelacion_ya_pedida_no_se_copia_nada() {
        let dir = scratch("copia-cancelada-de-antes");
        let source = dir.join("origen.bin");
        let dest = dir.join("destino.bin");
        std::fs::write(&source, patterned(3 * 1024 * 1024)).unwrap();
        let cancel = Arc::new(AtomicBool::new(true));

        let mut reported = 0;
        let result = copy_file_counting(&source, &dest, Some(&cancel), &mut |d| reported += d);

        assert_eq!(result.unwrap_err(), "Operation cancelled");
        assert_eq!(reported, 0);
        // Como mucho queda el archivo recién creado, sin contenido.
        assert_eq!(std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0), 0);
        cleanup(&dir);
    }

    #[test]
    fn cancelar_a_mitad_de_la_copia_corta_entre_chunks() {
        let dir = scratch("copia-cancelada-a-mitad");
        let source = dir.join("origen.bin");
        let dest = dir.join("destino.bin");
        std::fs::write(&source, patterned(3 * 1024 * 1024)).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));

        let mut reported = 0;
        let result = copy_file_counting(&source, &dest, Some(&cancel), &mut |delta| {
            reported += delta;
            // La persona cancela apenas llega el primer chunk.
            cancel.store(true, Ordering::SeqCst);
        });

        assert_eq!(result.unwrap_err(), "Operation cancelled");
        assert_eq!(
            reported,
            1024 * 1024,
            "tiene que parar antes del segundo chunk"
        );
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), 1024 * 1024);
        cleanup(&dir);
    }

    #[test]
    fn un_origen_que_no_existe_devuelve_error_y_no_reporta() {
        let dir = scratch("copia-sin-origen");
        let mut reported = 0;
        let result =
            copy_file_counting(&dir.join("no-esta"), &dir.join("destino"), None, &mut |d| {
                reported += d
            });
        assert!(result.is_err());
        assert_eq!(reported, 0);
        assert!(
            !dir.join("destino").exists(),
            "no tiene que crear el destino"
        );
        cleanup(&dir);
    }

    #[test]
    fn un_destino_imposible_de_crear_devuelve_error() {
        let dir = scratch("copia-sin-destino");
        let source = dir.join("origen.bin");
        std::fs::write(&source, b"x").unwrap();
        let result = copy_file_counting(&source, &dir.join("no/existe/destino"), None, &mut |_| {});
        assert!(result.is_err());
        cleanup(&dir);
    }

    #[test]
    fn copiar_una_carpeta_reporta_exactamente_lo_que_pesa() {
        let dir = scratch("copia-carpeta-bytes");
        let source = source_tree(&dir, 3);
        std::fs::write(source.join("sub/grande.bin"), patterned(1024 * 1024 + 7)).unwrap();
        let dest = dir.join("copia");

        let mut reported = 0;
        copy_unprivileged(&source, &dest, None, &mut |delta| reported += delta).unwrap();

        // Lo que alimenta la barra (lo reportado) coincide con el total que se
        // precalcula: por eso la barra termina en 100 y no antes ni después.
        assert_eq!(reported, path_size(&source));
        assert_eq!(path_size(&dest), path_size(&source));
        assert_eq!(
            std::fs::read(dest.join("sub/grande.bin")).unwrap(),
            patterned(1024 * 1024 + 7)
        );
        cleanup(&dir);
    }

    // --- Progreso por bytes bajo el mock de Tauri (#146) ---
    //
    // `copy_items_impl`, `move_items_impl` y `delete_items_impl` corren de verdad
    // contra un `AppHandle` de mentira; el evento del mock se entrega en el acto,
    // en el mismo hilo, así que se puede mirar lo emitido apenas vuelven.

    use tauri::test::{mock_app, MockRuntime};
    use tauri::{App, Listener};

    type Eventos = Arc<Mutex<Vec<serde_json::Value>>>;

    /// Anota cada `file-operation-progress` que sale, ya como JSON.
    fn escuchar(app: &App<MockRuntime>) -> Eventos {
        let eventos: Eventos = Arc::new(Mutex::new(Vec::new()));
        let guardados = eventos.clone();
        app.listen("file-operation-progress", move |evento| {
            let valor = serde_json::from_str(evento.payload()).unwrap();
            guardados.lock().unwrap().push(valor);
        });
        eventos
    }

    fn emitidos(eventos: &Eventos) -> Vec<serde_json::Value> {
        eventos.lock().unwrap().clone()
    }

    fn texto(ruta: &Path) -> String {
        ruta.to_string_lossy().into_owned()
    }

    /// Las pilas de deshacer son del proceso: las pruebas de `undo` las vacían y
    /// miran su contenido, y copiar, mover o borrar apila una entrada. Quien corra
    /// una operación entera toma el mismo candado.
    fn pilas() -> std::sync::MutexGuard<'static, ()> {
        crate::undo::tests::CANDADO_PILAS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn el_emisor_acumula_bytes_y_devuelve_el_total_parcial() {
        let app = mock_app();
        let handle = app.handle().clone();
        let id = Some("emisor-acumula".to_string());
        let progress = CopyProgress::new(&handle, &id, 2, 100);

        assert_eq!(progress.bytes(), 0);
        assert_eq!(progress.add_bytes(30), 30);
        assert_eq!(progress.add_bytes(20), 50);
        assert_eq!(progress.bytes(), 50);
    }

    #[test]
    fn el_emisor_sin_id_no_emite_nada_ni_forzado() {
        let app = mock_app();
        let eventos = escuchar(&app);
        let handle = app.handle().clone();
        let id = None;
        let progress = CopyProgress::new(&handle, &id, 1, 10);

        progress.emit(0, "/a", 5, false);
        progress.emit(1, "", 10, true);

        assert!(emitidos(&eventos).is_empty());
    }

    #[test]
    fn el_emisor_no_repite_un_evento_antes_del_intervalo_salvo_que_se_fuerce() {
        let app = mock_app();
        let eventos = escuchar(&app);
        let handle = app.handle().clone();
        let id = Some("emisor-throttle".to_string());
        let progress = CopyProgress::new(&handle, &id, 3, 300);

        // El primero siempre sale; los que siguen, dentro de los 100 ms, no.
        progress.emit(0, "/a/uno.bin", 10, false);
        progress.emit(0, "/a/uno.bin", 20, false);
        progress.emit(1, "/a/dos.bin", 30, false);
        assert_eq!(emitidos(&eventos).len(), 1);

        // El forzado (el final) sale aunque no haya pasado el intervalo.
        progress.emit(3, "", 300, true);
        let salidos = emitidos(&eventos);
        assert_eq!(salidos.len(), 2);

        assert_eq!(salidos[0]["operation_id"], "emisor-throttle");
        assert_eq!(salidos[0]["kind"], "copy");
        assert_eq!(salidos[0]["processed"], 0);
        assert_eq!(salidos[0]["total"], 3);
        assert_eq!(salidos[0]["current"], "/a/uno.bin");
        assert_eq!(salidos[0]["processed_bytes"], 10);
        assert_eq!(salidos[0]["total_bytes"], 300);
        assert_eq!(salidos[1]["processed"], 3);
        assert_eq!(salidos[1]["processed_bytes"], 300);
        assert_eq!(salidos[1]["current"], "");
    }

    #[test]
    fn el_emisor_vuelve_a_emitir_pasado_el_intervalo() {
        let app = mock_app();
        let eventos = escuchar(&app);
        let handle = app.handle().clone();
        let id = Some("emisor-intervalo".to_string());
        let progress = CopyProgress::new(&handle, &id, 1, 100);

        progress.emit(0, "/a", 1, false);
        std::thread::sleep(PROGRESS_THROTTLE + Duration::from_millis(20));
        progress.emit(0, "/a", 2, false);

        let salidos = emitidos(&eventos);
        assert_eq!(salidos.len(), 2);
        // Con tiempo transcurrido hay velocidad: bytes sobre segundos.
        assert!(salidos[1]["bytes_per_second"].as_u64().unwrap() > 0);
    }

    #[test]
    fn copiar_varios_archivos_emite_el_avance_por_bytes_y_cierra_en_el_total() {
        let _pilas = pilas();
        let dir = scratch("impl-copia-varios");
        let origen = dir.join("origen");
        let destino = dir.join("destino");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::create_dir_all(&destino).unwrap();
        let chico = origen.join("chico.txt");
        let grande = origen.join("grande.bin");
        let carpeta = source_tree(&origen, 2);
        std::fs::write(&chico, b"hola").unwrap();
        // Varios chunks seguidos: los primeros salen, el resto cae en el intervalo.
        std::fs::write(&grande, patterned(3 * 1024 * 1024 + 99)).unwrap();
        let fuentes = vec![texto(&chico), texto(&grande), texto(&carpeta)];
        let total_bytes = total_source_bytes(&fuentes);

        let app = mock_app();
        let eventos = escuchar(&app);
        let resultado = copy_items_impl(
            fuentes,
            texto(&destino),
            None,
            Some("impl-copia-varios".to_string()),
            app.handle().clone(),
        );

        assert!(resultado.success, "{:?}", resultado.error);
        assert_eq!(resultado.copied_count, Some(3));
        assert_eq!(resultado.failed_count, Some(0));
        assert_eq!(resultado.skipped_count, Some(0));
        assert_eq!(
            std::fs::read(destino.join("grande.bin")).unwrap(),
            patterned(3 * 1024 * 1024 + 99)
        );
        assert!(destino.join("origen/sub/b1.txt").is_file());

        let salidos = emitidos(&eventos);
        assert!(salidos.len() >= 2, "el primero y el final, como poco");
        for evento in &salidos {
            assert_eq!(evento["operation_id"], "impl-copia-varios");
            assert_eq!(evento["kind"], "copy");
            assert_eq!(evento["total"], 3);
            // El total se precalcula una vez y no cambia.
            assert_eq!(evento["total_bytes"], total_bytes);
            assert!(evento["processed_bytes"].as_u64().unwrap() <= total_bytes);
        }
        // Los bytes sólo avanzan.
        let avance: Vec<u64> = salidos
            .iter()
            .map(|e| e["processed_bytes"].as_u64().unwrap())
            .collect();
        assert!(avance.windows(2).all(|par| par[0] <= par[1]), "{avance:?}");
        // El primero sale antes de copiar nada; el último, forzado, en el total.
        assert_eq!(salidos[0]["processed_bytes"], 0);
        let ultimo = salidos.last().unwrap();
        assert_eq!(ultimo["processed"], 3);
        assert_eq!(ultimo["processed_bytes"], total_bytes);
        assert_eq!(ultimo["current"], "");
        cleanup(&dir);
    }

    #[test]
    fn copiar_sin_id_de_operacion_no_emite_pero_copia() {
        let _pilas = pilas();
        let dir = scratch("impl-copia-sin-id");
        let origen = dir.join("a.txt");
        let destino = dir.join("destino");
        std::fs::create_dir_all(&destino).unwrap();
        std::fs::write(&origen, b"contenido").unwrap();

        let app = mock_app();
        let eventos = escuchar(&app);
        let resultado = copy_items_impl(
            vec![texto(&origen)],
            texto(&destino),
            None,
            None,
            app.handle().clone(),
        );

        assert_eq!(resultado.copied_count, Some(1));
        assert_eq!(std::fs::read(destino.join("a.txt")).unwrap(), b"contenido");
        assert!(emitidos(&eventos).is_empty());
        cleanup(&dir);
    }

    #[test]
    fn copiar_con_reemplazar_pisa_lo_que_habia_y_cuenta_una_copia() {
        let _pilas = pilas();
        let dir = scratch("impl-copia-reemplaza");
        let origen = dir.join("origen");
        let destino = dir.join("destino");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::create_dir_all(&destino).unwrap();
        std::fs::write(origen.join("a.txt"), b"nuevo y mas largo").unwrap();
        std::fs::write(destino.join("a.txt"), b"viejo").unwrap();

        let app = mock_app();
        let resultado = copy_items_impl(
            vec![texto(&origen.join("a.txt"))],
            texto(&destino),
            Some("replace".to_string()),
            Some("impl-copia-reemplaza".to_string()),
            app.handle().clone(),
        );

        assert!(resultado.success, "{:?}", resultado.error);
        assert_eq!(resultado.copied_count, Some(1));
        assert_eq!(
            std::fs::read(destino.join("a.txt")).unwrap(),
            b"nuevo y mas largo"
        );
        // No quedó una copia renombrada al lado.
        assert_eq!(std::fs::read_dir(&destino).unwrap().count(), 1);
        cleanup(&dir);
    }

    #[test]
    fn copiar_con_omitir_deja_lo_que_habia_y_cuenta_un_omitido() {
        let _pilas = pilas();
        let dir = scratch("impl-copia-omite");
        let origen = dir.join("origen");
        let destino = dir.join("destino");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::create_dir_all(&destino).unwrap();
        std::fs::write(origen.join("a.txt"), b"nuevo").unwrap();
        std::fs::write(destino.join("a.txt"), b"viejo").unwrap();

        let app = mock_app();
        let eventos = escuchar(&app);
        let resultado = copy_items_impl(
            vec![texto(&origen.join("a.txt"))],
            texto(&destino),
            Some("skip".to_string()),
            Some("impl-copia-omite".to_string()),
            app.handle().clone(),
        );

        assert_eq!(resultado.copied_count, Some(0));
        assert_eq!(resultado.skipped_count, Some(1));
        assert_eq!(std::fs::read(destino.join("a.txt")).unwrap(), b"viejo");
        // Aunque no se copió nada, la barra cierra en el total.
        let ultimo = emitidos(&eventos).pop().unwrap();
        assert_eq!(ultimo["processed_bytes"], ultimo["total_bytes"]);
        assert_eq!(ultimo["total_bytes"], 5);
        cleanup(&dir);
    }

    #[test]
    fn copiar_un_origen_que_no_existe_falla_y_la_barra_igual_cierra() {
        let _pilas = pilas();
        let dir = scratch("impl-copia-sin-origen");
        let destino = dir.join("destino");
        std::fs::create_dir_all(&destino).unwrap();
        let buena = dir.join("buena.txt");
        std::fs::write(&buena, b"1234").unwrap();

        let app = mock_app();
        let eventos = escuchar(&app);
        let resultado = copy_items_impl(
            vec![texto(&dir.join("fantasma.txt")), texto(&buena)],
            texto(&destino),
            None,
            Some("impl-copia-sin-origen".to_string()),
            app.handle().clone(),
        );

        assert!(!resultado.success);
        assert_eq!(resultado.failed_count, Some(1));
        assert_eq!(resultado.copied_count, Some(1));
        assert!(resultado.error.unwrap().contains("fantasma.txt"));
        let ultimo = emitidos(&eventos).pop().unwrap();
        assert_eq!(ultimo["processed"], 2);
        assert_eq!(ultimo["processed_bytes"], 4);
        assert_eq!(ultimo["total_bytes"], 4);
        cleanup(&dir);
    }

    #[test]
    fn copiar_a_un_destino_que_no_existe_o_no_es_carpeta_falla_sin_emitir() {
        let _pilas = pilas();
        let dir = scratch("impl-copia-destino-malo");
        let archivo = dir.join("a.txt");
        std::fs::write(&archivo, b"x").unwrap();

        let app = mock_app();
        let eventos = escuchar(&app);
        let no_existe = copy_items_impl(
            vec![texto(&archivo)],
            texto(&dir.join("no-esta")),
            None,
            Some("impl-copia-destino-malo".to_string()),
            app.handle().clone(),
        );
        let no_es_carpeta = copy_items_impl(
            vec![texto(&archivo)],
            texto(&archivo),
            None,
            Some("impl-copia-destino-malo".to_string()),
            app.handle().clone(),
        );

        assert!(!no_existe.success);
        assert!(no_existe.error.unwrap().contains("does not exist"));
        assert!(!no_es_carpeta.success);
        assert!(no_es_carpeta.error.unwrap().contains("not a directory"));
        assert!(emitidos(&eventos).is_empty());
        cleanup(&dir);
    }

    #[test]
    fn cancelar_en_pleno_avance_corta_la_copia_y_no_sigue_con_el_resto() {
        let _pilas = pilas();
        let dir = scratch("impl-copia-cancelada");
        let destino = dir.join("destino");
        std::fs::create_dir_all(&destino).unwrap();
        let uno = dir.join("uno.bin");
        let dos = dir.join("dos.bin");
        std::fs::write(&uno, patterned(3 * 1024 * 1024)).unwrap();
        std::fs::write(&dos, b"nunca llega").unwrap();

        let app = mock_app();
        // La persona cancela en cuanto ve el primer avance, como lo haría el botón
        // de la ventana: por el id de la operación.
        app.listen("file-operation-progress", |_| {
            cancel_file_operation("impl-copia-cancelada".to_string());
        });
        let resultado = copy_items_impl(
            vec![texto(&uno), texto(&dos)],
            texto(&destino),
            None,
            Some("impl-copia-cancelada".to_string()),
            app.handle().clone(),
        );

        assert!(!resultado.success);
        assert_eq!(resultado.copied_count, Some(0));
        assert_eq!(resultado.error.as_deref(), Some("Operation cancelled"));
        assert!(!destino.join("dos.bin").exists(), "el resto no se toca");
        // La operación se da de baja: cancelarla de nuevo ya no encuentra nada.
        assert!(!cancel_file_operation("impl-copia-cancelada".to_string()));
        cleanup(&dir);
    }

    #[test]
    fn cancelar_antes_de_elevar_no_pide_la_contrasena() {
        if running_as_root() {
            return;
        }
        let _pilas = pilas();
        let dir = scratch("impl-copia-cancelada-elevada");
        let origen = dir.join("a.txt");
        let otro = dir.join("b.txt");
        std::fs::write(&origen, b"1").unwrap();
        std::fs::write(&otro, b"2").unwrap();
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(&root).unwrap();
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);

        let app = mock_app();
        app.listen("file-operation-progress", |_| {
            cancel_file_operation("impl-copia-cancelada-elevada".to_string());
        });
        let resultado = copy_items_impl(
            vec![texto(&origen), texto(&otro)],
            texto(&root),
            None,
            Some("impl-copia-cancelada-elevada".to_string()),
            app.handle().clone(),
        );

        // El primero quedó esperando elevación y la cancelación lo descartó: sin
        // contraseña y sin tocar el destino.
        assert!(!resultado.success);
        assert_eq!(resultado.copied_count, Some(0));
        assert_eq!(resultado.failed_count, Some(1));
        assert_eq!(invocations(&log), Vec::<String>::new());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        cleanup(&dir);
    }

    #[test]
    fn copiar_a_un_destino_de_root_eleva_y_suma_el_tamano_de_lo_copiado() {
        if running_as_root() {
            return;
        }
        let _pilas = pilas();
        let dir = scratch("impl-copia-elevada");
        let origen = dir.join("origen.bin");
        std::fs::write(&origen, patterned(2048)).unwrap();
        let root = dir.join("destino-de-root");
        std::fs::create_dir_all(&root).unwrap();
        make_read_only(&root);
        let log = install_authorizing(&dir, &root);

        let app = mock_app();
        let eventos = escuchar(&app);
        let resultado = copy_items_impl(
            vec![texto(&origen)],
            texto(&root),
            None,
            Some("impl-copia-elevada".to_string()),
            app.handle().clone(),
        );

        assert!(resultado.success, "{:?}", resultado.error);
        assert_eq!(resultado.copied_count, Some(1));
        assert_eq!(invocations(&log).len(), 1, "{:?}", invocations(&log));
        assert_eq!(
            std::fs::read(root.join("origen.bin")).unwrap(),
            patterned(2048)
        );
        // Lo elevado no se mide por chunk: se suma de golpe al terminar.
        let ultimo = emitidos(&eventos).pop().unwrap();
        assert_eq!(ultimo["processed_bytes"], 2048);
        assert_eq!(ultimo["total_bytes"], 2048);
        cleanup(&dir);
    }

    #[test]
    fn mover_emite_el_avance_por_archivos_con_los_bytes_en_cero() {
        let _pilas = pilas();
        let dir = scratch("impl-mueve");
        let origen = dir.join("origen");
        let destino = dir.join("destino");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::create_dir_all(&destino).unwrap();
        let uno = origen.join("uno.txt");
        let dos = origen.join("dos.txt");
        std::fs::write(&uno, b"1").unwrap();
        std::fs::write(&dos, b"22").unwrap();

        let app = mock_app();
        let eventos = escuchar(&app);
        let resultado = move_items_impl(
            vec![texto(&uno), texto(&dos)],
            texto(&destino),
            None,
            Some("impl-mueve".to_string()),
            app.handle().clone(),
        );

        assert!(resultado.success, "{:?}", resultado.error);
        assert_eq!(resultado.copied_count, Some(2));
        assert!(destino.join("uno.txt").is_file() && destino.join("dos.txt").is_file());
        assert!(!uno.exists() && !dos.exists());

        let salidos = emitidos(&eventos);
        assert_eq!(salidos.len(), 3, "uno por archivo y el final");
        for evento in &salidos {
            assert_eq!(evento["operation_id"], "impl-mueve");
            assert_eq!(evento["kind"], "move");
            assert_eq!(evento["total"], 2);
            // El frontend cae al conteo cuando los tres vienen en 0.
            assert_eq!(evento["processed_bytes"], 0);
            assert_eq!(evento["total_bytes"], 0);
            assert_eq!(evento["bytes_per_second"], 0);
        }
        let avance: Vec<u64> = salidos
            .iter()
            .map(|e| e["processed"].as_u64().unwrap())
            .collect();
        assert_eq!(avance, vec![0, 1, 2]);
        assert_eq!(salidos[0]["current"], texto(&uno));
        assert_eq!(salidos[2]["current"], "");
        cleanup(&dir);
    }

    #[test]
    fn mover_sin_id_de_operacion_no_emite_pero_mueve() {
        let _pilas = pilas();
        let dir = scratch("impl-mueve-sin-id");
        let destino = dir.join("destino");
        std::fs::create_dir_all(&destino).unwrap();
        let archivo = dir.join("a.txt");
        std::fs::write(&archivo, b"x").unwrap();

        let app = mock_app();
        let eventos = escuchar(&app);
        let resultado = move_items_impl(
            vec![texto(&archivo)],
            texto(&destino),
            None,
            None,
            app.handle().clone(),
        );

        assert_eq!(resultado.copied_count, Some(1));
        assert!(destino.join("a.txt").is_file());
        assert!(emitidos(&eventos).is_empty());
        cleanup(&dir);
    }

    #[test]
    fn mover_a_un_destino_que_no_existe_o_no_es_carpeta_falla() {
        let _pilas = pilas();
        let dir = scratch("impl-mueve-destino-malo");
        let archivo = dir.join("a.txt");
        std::fs::write(&archivo, b"x").unwrap();

        let app = mock_app();
        let no_existe = move_items_impl(
            vec![texto(&archivo)],
            texto(&dir.join("no-esta")),
            None,
            None,
            app.handle().clone(),
        );
        let no_es_carpeta = move_items_impl(
            vec![texto(&archivo)],
            texto(&archivo),
            None,
            None,
            app.handle().clone(),
        );

        assert!(!no_existe.success);
        assert!(no_existe.error.unwrap().contains("does not exist"));
        assert!(!no_es_carpeta.success);
        assert!(no_es_carpeta.error.unwrap().contains("not a directory"));
        assert!(archivo.exists(), "no se movió nada");
        cleanup(&dir);
    }

    #[test]
    fn borrar_emite_el_avance_por_archivos_con_los_bytes_en_cero() {
        let _pilas = pilas();
        let dir = scratch("impl-borra");
        let uno = dir.join("uno.txt");
        let carpeta = source_tree(&dir, 1);
        std::fs::write(&uno, b"1").unwrap();

        let app = mock_app();
        let eventos = escuchar(&app);
        let resultado = delete_items_impl(
            vec![texto(&uno), texto(&carpeta)],
            false,
            Some("impl-borra".to_string()),
            None,
            app.handle().clone(),
        );

        assert!(resultado.success, "{:?}", resultado.error);
        assert_eq!(resultado.copied_count, Some(2));
        assert_eq!(resultado.failed_count, Some(0));
        assert_eq!(resultado.skipped_count, Some(0));
        assert!(!uno.exists() && !carpeta.exists());

        let salidos = emitidos(&eventos);
        assert_eq!(salidos.len(), 3, "uno por ruta y el final");
        for evento in &salidos {
            assert_eq!(evento["operation_id"], "impl-borra");
            assert_eq!(evento["kind"], "delete");
            assert_eq!(evento["total"], 2);
            assert_eq!(evento["processed_bytes"], 0);
            assert_eq!(evento["total_bytes"], 0);
            assert_eq!(evento["bytes_per_second"], 0);
        }
        assert_eq!(salidos[2]["processed"], 2);
        cleanup(&dir);
    }

    #[test]
    fn borrar_una_ruta_que_no_existe_cuenta_un_fallo_y_sigue_con_las_demas() {
        let _pilas = pilas();
        let dir = scratch("impl-borra-fantasma");
        let real = dir.join("real.txt");
        std::fs::write(&real, b"x").unwrap();

        let app = mock_app();
        let resultado = delete_items_impl(
            vec![texto(&dir.join("fantasma.txt")), texto(&real)],
            false,
            None,
            Some(false),
            app.handle().clone(),
        );

        assert!(!resultado.success);
        assert_eq!(resultado.failed_count, Some(1));
        assert_eq!(resultado.copied_count, Some(1));
        assert!(resultado.error.unwrap().contains("fantasma.txt"));
        assert!(!real.exists());
        cleanup(&dir);
    }
}
