//! Publica el avance de las operaciones de archivo como
//! `com.canonical.Unity.LauncherEntry`, para que el panel de VasakOS muestre la
//! copia/movimiento/borrado en curso en su cápsula de actividad.
//!
//! No es una interfaz que se consulta sino una **señal** que se emite en el bus
//! de sesión: `Update(s app_uri, a{sv} properties)`. El `app_uri` es
//! `application://vasak-file-manager.desktop`; el panel le quita el
//! `application://` y el `.desktop` y cruza el id resultante con el `app_id` de
//! la ventana (ambos normalizan a `vasakfilemanager`). Se mandan sólo `progress`
//! (de 0 a 1) y `progress-visible`.
//!
//! No toca el código de las operaciones: escucha el evento interno
//! `file-operation-progress` que ya emiten, lo traduce con
//! `OperationProgress::launcher_progress` (la parte medible, probada en
//! `file_operations`) y reemite por D-Bus desde una tarea async —zbus acá es
//! sólo async—. Es glue sin runtime real que probar, así que vive en `commands/`,
//! que el análisis de cobertura excluye.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Listener};
use zbus::zvariant::Value;

use crate::file_operations::OperationProgress;

/// El `.desktop` del gestor, con el que el panel lo cruza con su ventana.
const APP_URI: &str = "application://vasak-file-manager.desktop";
const INTERFACE: &str = "com.canonical.Unity.LauncherEntry";

/// No inundar el bus: un movimiento o un borrado de muchos ítems emite un evento
/// por ítem. La copia ya viene throttleada a 100 ms; esto cubre a los otros dos.
const THROTTLE: Duration = Duration::from_millis(80);

/// Arranca el puente. Best-effort: si no hay bus de sesión, el gestor funciona
/// igual, sólo que el panel no muestra el avance.
pub fn start(app: &AppHandle) {
    let (tx, mut rx) = tauri::async_runtime::channel::<(f64, bool)>(64);

    tauri::async_runtime::spawn(async move {
        let connection = match zbus::Connection::session().await {
            Ok(connection) => connection,
            Err(error) => {
                log::warn!("No se pudo abrir el bus de sesión para LauncherEntry: {error}");
                return;
            }
        };

        let mut last = Instant::now()
            .checked_sub(THROTTLE)
            .unwrap_or_else(Instant::now);

        while let Some((progress, visible)) = rx.recv().await {
            // El fin (y la cancelación) llegan con `visible = false`: ese nunca se
            // saltea, así el aro siempre se apaga.
            if visible && last.elapsed() < THROTTLE {
                continue;
            }
            last = Instant::now();

            let properties: HashMap<&str, Value> = HashMap::from([
                ("progress", Value::F64(progress)),
                ("progress-visible", Value::Bool(visible)),
            ]);
            if let Err(error) = connection
                .emit_signal(
                    None::<&str>,
                    "/",
                    INTERFACE,
                    "Update",
                    &(APP_URI, properties),
                )
                .await
            {
                log::warn!("No se pudo emitir LauncherEntry: {error}");
            }
        }
    });

    app.listen("file-operation-progress", move |event| {
        let Ok(progress) = serde_json::from_str::<OperationProgress>(event.payload()) else {
            return;
        };
        if let Some(update) = progress.launcher_progress() {
            let _ = tx.try_send(update);
        }
    });
}
