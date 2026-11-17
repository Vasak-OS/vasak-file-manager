//! Los comandos de copiar, mover y borrar archivos.
//!
//! Son glue de IPC: `async` para no bloquear el hilo principal —los comandos
//! síncronos de Tauri corren ahí y una operación grande congelaba el webview
//! entero hasta terminar (#191)— y delegan en `run_off_main`, que lleva el
//! trabajo a un hilo aparte. La lógica medible (ese reparto, la copia, el
//! progreso, la cancelación) vive en `crate::file_operations` y queda cubierta
//! por sus pruebas; estos cuerpos no se pueden ejercitar sin un runtime real de
//! Tauri, así que viven en `commands/`, que el análisis de cobertura excluye
//! —igual que los `.vue` y el resto de la capa de comandos—.

use tauri::AppHandle;

use crate::file_operations::{
    copy_items_impl, delete_items_impl, move_items_impl, run_off_main, FileOperationResult,
};

#[tauri::command]
pub async fn copy_items(
    source_paths: Vec<String>,
    destination_path: String,
    conflict_resolution: Option<String>,
    operation_id: Option<String>,
    app: AppHandle,
) -> FileOperationResult {
    run_off_main(move || {
        copy_items_impl(
            source_paths,
            destination_path,
            conflict_resolution,
            operation_id,
            app,
        )
    })
    .await
}

#[tauri::command]
pub async fn move_items(
    source_paths: Vec<String>,
    destination_path: String,
    conflict_resolution: Option<String>,
    operation_id: Option<String>,
    app: AppHandle,
) -> FileOperationResult {
    run_off_main(move || {
        move_items_impl(
            source_paths,
            destination_path,
            conflict_resolution,
            operation_id,
            app,
        )
    })
    .await
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
pub async fn delete_items(
    paths: Vec<String>,
    use_trash: bool,
    operation_id: Option<String>,
    allow_elevation: Option<bool>,
    app: AppHandle,
) -> FileOperationResult {
    run_off_main(move || delete_items_impl(paths, use_trash, operation_id, allow_elevation, app))
        .await
}
