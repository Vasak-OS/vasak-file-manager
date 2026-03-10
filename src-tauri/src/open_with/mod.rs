mod types;
mod utils;
mod linux;

pub use types::{GetAssociatedProgramsResult, OpenWithResult};

use std::path::Path;
use std::process::Command;
use utils::canonicalize_path;

#[tauri::command]
pub fn get_associated_programs(file_path: String) -> GetAssociatedProgramsResult {
        linux::get_associated_programs_impl(&file_path)
}

#[tauri::command]
pub fn open_with_program(
    file_path: String,
    program_path: String,
    arguments: Vec<String>,
) -> OpenWithResult {
    let file = Path::new(&file_path);
    if !file.exists() {
        return OpenWithResult {
            success: false,
            error: Some(format!("File not found: {}", file_path)),
        };
    }

    let absolute_file_path = canonicalize_path(file);

        if arguments.is_empty() {
            if let Some(result) = linux::open_with_desktop_id(&program_path, &absolute_file_path) {
                if result.success {
                    return result;
                }
                return result;
            }
        }
    

    let program = Path::new(&program_path);
    if !program.exists() {
        return OpenWithResult {
            success: false,
            error: Some(format!("Program not found: {}", program_path)),
        };
    }

    let mut command = Command::new(&program_path);

    if arguments.is_empty() {
        command.arg(&absolute_file_path);
    } else {
        let mut file_arg_added = false;
        for arg in &arguments {
            if arg.contains("%1") {
                command.arg(arg.replace("%1", &absolute_file_path));
                file_arg_added = true;
            } else if arg.contains("\"%1\"") {
                command.arg(arg.replace("\"%1\"", &absolute_file_path));
                file_arg_added = true;
            } else {
                command.arg(arg);
            }
        }
        if !file_arg_added {
            command.arg(&absolute_file_path);
        }
    }


    match command.spawn() {
        Ok(_) => OpenWithResult {
            success: true,
            error: None,
        },
        Err(spawn_error) => OpenWithResult {
            success: false,
            error: Some(format!("Failed to start program: {}", spawn_error)),
        },
    }
}

#[tauri::command]
pub fn open_with_default(file_path: String) -> OpenWithResult {

        match Command::new("xdg-open").arg(&file_path).spawn() {
            Ok(_) => OpenWithResult {
                success: true,
                error: None,
            },
            Err(spawn_error) => OpenWithResult {
                success: false,
                error: Some(format!("Failed to open file: {}", spawn_error)),
            },
        }
    
}


