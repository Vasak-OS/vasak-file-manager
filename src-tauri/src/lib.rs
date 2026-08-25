mod startup_path;
mod dir_reader;
mod dir_size;
mod dir_watcher;

mod clipboard;
mod compress;
mod extract;
mod file_operations;
mod global_search;
mod open_with;
mod polkit;
mod read_file;
mod mount_watcher;
mod system_icons;
mod video_thumbnail;
mod terminal;
mod undo;
pub mod utils;

// Sólo lo necesita el descubrimiento del webview, que es de debug.
#[cfg(debug_assertions)]
use gtk::prelude::*;
use std::path::PathBuf;
use tauri::Manager;
// Sólo se usan para abrir las herramientas de desarrollo, que no existen en
// un build de release.
#[cfg(debug_assertions)]
use webkit2gtk::{SettingsExt, WebViewExt};

/// Where the translations are. The plugin only probes paths relative to the
/// binary and to the working directory, and none of those exist for a binary in
/// /usr/bin, so the installed location has to be named explicitly or the whole
/// interface shows translation keys.
fn locales_dir() -> Option<String> {
    let candidates = [
        PathBuf::from("locales"),
        PathBuf::from("src-tauri/locales"),
        PathBuf::from("/usr/share/vasak-file-manager/locales"),
    ];

    candidates
        .into_iter()
        .find(|path| path.is_dir())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Picks the startup language from the session locale, falling back to Spanish,
/// which is what the UI shipped with before it was translatable.
fn default_locale() -> String {
    let raw = std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LC_MESSAGES"))
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_default();

    match raw.split(['_', '.', '@']).next().unwrap_or("") {
        "en" => "en".to_string(),
        _ => "es".to_string(),
    }
}

#[cfg(debug_assertions)]
fn find_webkit_webview(container: &gtk::Container) -> Option<webkit2gtk::WebView> {
    for child in container.children() {
        if child.type_().name() == "WebKitWebView" {
            return child.downcast::<webkit2gtk::WebView>().ok();
        }
        if let Some(child_container) = child.downcast_ref::<gtk::Container>() {
            if let Some(found) = find_webkit_webview(child_container) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // El kernel avisa cuando cambia la tabla de montajes, así que el
            // frontend no tiene que preguntar por las unidades cada cinco
            // segundos. Ver `mount_watcher`.
            mount_watcher::start(app.handle().clone());

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(debug_assertions)]
                if let Ok(gtk_window) = window.gtk_window() {
                    let container = gtk_window.clone().upcast::<gtk::Container>();
                    if let Some(wv) = find_webkit_webview(&container) {
                        if let Some(settings) = WebViewExt::settings(&wv) {
                            settings.set_enable_developer_extras(true);
                        }
                    }
                }
                let icon_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/icon.png");
                if icon_path.exists() {
                    if let Ok(image) = tauri::image::Image::from_path(&icon_path) {
                        let _ = window.set_icon(image);
                    }
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_config_manager::init())
        .plugin(tauri_plugin_vicons::init())
        .plugin(tauri_plugin_i18n_vsk::init_with_path(
            Some(default_locale()),
            locales_dir(),
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["quick-view"])
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_system_fonts::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_drag_and_drop_wayland::init())
        .plugin(tauri_plugin_vsk_contextual_menu::init())
        .invoke_handler(tauri::generate_handler![
            video_thumbnail,
            clipboard::clipboard_read_text,
            clipboard::clipboard_write_text,
            dir_reader::read_dir,
            startup_path::startup_path,
            dir_reader::get_system_drives,
            dir_reader::get_parent_dir,
            dir_reader::path_exists,
            dir_reader::get_mountable_devices,
            dir_reader::mount_drive,
            dir_reader::unmount_drive,
            dir_reader::mount_network_share,
            dir_size::get_dir_size,
            dir_size::get_dir_sizes_batch,
            dir_size::get_dir_size_progress,
            dir_size::get_active_calculations,
            dir_size::invalidate_dir_size_cache,
            dir_size::clear_dir_size_cache,
            dir_size::cancel_dir_size,
            file_operations::check_conflicts,
            file_operations::copy_items,
            file_operations::ensure_directory,
            file_operations::move_items,
            file_operations::rename_item,
            file_operations::delete_items,
            file_operations::cancel_file_operation,
            file_operations::create_item,
            global_search::global_search_init,
            global_search::global_search_get_status,
            global_search::global_search_start_scan,
            global_search::global_search_cancel_scan,
            global_search::global_search_index_paths,
            global_search::global_search_query,
            global_search::global_search_query_paths,
            open_with::get_associated_programs,
            open_with::open_with_program,
            open_with::open_with_default,
            system_icons::get_system_icon,
            terminal::get_available_terminals,
            terminal::get_terminal_icons,
            terminal::open_terminal,
            dir_watcher::watch_directory,
            dir_watcher::unwatch_directory,
            dir_watcher::get_watched_directories,
            extract::extract_archive,
            compress::compress_items,
            undo::undo_last_operation,
            undo::get_undo_info,
            undo::clear_undo_history,
            read_file::read_text_file,
            read_file::read_pdf_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Ruta de la miniatura de un video, generándola con ffmpeg si hace falta.
///
/// Devuelve una ruta y no la imagen: la vista la carga con el protocolo de
/// archivos, así que los bytes no cruzan el IPC. Antes cada miniatura viajaba
/// como data URL en base64 —un tercio más de bytes— y se volvía a generar en
/// cada visita a la carpeta, decodificando el video a resolución completa
/// dentro del proceso de la interfaz.
#[tauri::command]
async fn video_thumbnail(path: String) -> Result<String, String> {
    // En un hilo aparte: ffmpeg tarda cientos de milisegundos y el hilo de los
    // comandos atiende a toda la ventana.
    tauri::async_runtime::spawn_blocking(move || {
        video_thumbnail::miniatura(std::path::Path::new(&path))
            .map(|ruta| ruta.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| format!("La generación de la miniatura se interrumpió: {error}"))?
}
