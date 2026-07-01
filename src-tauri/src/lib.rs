mod dir_reader;
mod dir_size;
mod dir_watcher;

mod extract;
mod file_operations;
mod global_search;
mod open_with;
mod polkit;
mod read_file;
mod system_icons;
mod terminal;
pub mod utils;

use gtk::prelude::*;
use tauri::Manager;
use webkit2gtk::{SettingsExt, WebViewExt};

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
        .plugin(tauri_plugin_i18n_vsk::init(None))
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
        .invoke_handler(tauri::generate_handler![
            dir_reader::read_dir,
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
            read_file::read_text_file,
            read_file::read_pdf_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
