//! El portapapeles del sistema.
//!
//! El webview no puede leerlo: WebKitGTK no implementa el permiso
//! «clipboard-read», así que `navigator.clipboard.readText()` no devuelve nada.
//! Con el menú del motor apagado, ese era el único camino que quedaba para pegar
//! en un campo de texto —renombrar, la barra de direcciones—, y también es la
//! razón por la que «ir a la ruta copiada» no hacía nada.
//!
//! GTK sí puede, porque es el que ya tiene la conexión con el compositor, pero
//! sus funciones de portapapeles sólo valen en el hilo principal: de ahí el salto
//! y el canal para traer la respuesta de vuelta.

use tauri::AppHandle;

fn con_portapapeles<T, F>(app: &AppHandle, accion: F) -> Result<T, String>
where
    F: FnOnce(&gtk::Clipboard) -> T + Send + 'static,
    T: Send + 'static,
{
    let (emisor, receptor) = std::sync::mpsc::channel();

    app.run_on_main_thread(move || {
        let portapapeles = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
        let _ = emisor.send(accion(&portapapeles));
    })
    .map_err(|error| error.to_string())?;

    receptor.recv().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn clipboard_read_text(app: AppHandle) -> Result<String, String> {
    con_portapapeles(&app, |portapapeles| {
        portapapeles
            .wait_for_text()
            .map(|texto| texto.to_string())
            .unwrap_or_default()
    })
}

#[tauri::command]
pub async fn clipboard_write_text(app: AppHandle, text: String) -> Result<(), String> {
    con_portapapeles(&app, move |portapapeles| {
        portapapeles.set_text(&text);
        // Sin esto, lo copiado se pierde al cerrar la ventana: el gestor de
        // portapapeles se queda con el texto sólo si se lo pide.
        portapapeles.store();
    })
}
