use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use walkdir::WalkDir;

use crate::file_operations::{emit_progress, is_cancelled, register_operation, unregister_operation};
use crate::undo;

/// How often the supervisor loop checks for cancellation / publishes progress.
const POLL_INTERVAL: Duration = Duration::from_millis(120);

#[derive(Serialize)]
pub struct CompressResult {
    pub success: bool,
    pub error: Option<String>,
    pub archive_path: Option<String>,
    pub cancelled: bool,
}

fn failure(error: impl Into<String>) -> CompressResult {
    CompressResult {
        success: false,
        error: Some(error.into()),
        archive_path: None,
        cancelled: false,
    }
}

/// The archive formats we can produce, with the extension and the argv that
/// builds them. Each command is run with the sources' parent as the working
/// directory so archive members are stored relative, never as absolute paths.
struct FormatSpec {
    extension: &'static str,
    program: &'static str,
    /// Arguments preceding the archive path.
    leading_args: &'static [&'static str],
    /// Tool name to name in the "not installed" error.
    package_hint: &'static str,
}

fn format_spec(format: &str) -> Option<FormatSpec> {
    match format {
        "zip" => Some(FormatSpec {
            extension: "zip",
            program: "zip",
            leading_args: &["-r"],
            package_hint: "zip",
        }),
        "tar.gz" => Some(FormatSpec {
            extension: "tar.gz",
            program: "tar",
            leading_args: &["-czvf"],
            package_hint: "tar",
        }),
        "tar.xz" => Some(FormatSpec {
            extension: "tar.xz",
            program: "tar",
            leading_args: &["-cJvf"],
            package_hint: "tar",
        }),
        "tar.bz2" => Some(FormatSpec {
            extension: "tar.bz2",
            program: "tar",
            leading_args: &["-cjvf"],
            package_hint: "tar",
        }),
        "tar" => Some(FormatSpec {
            extension: "tar",
            program: "tar",
            leading_args: &["-cvf"],
            package_hint: "tar",
        }),
        "7z" => Some(FormatSpec {
            extension: "7z",
            program: "7z",
            leading_args: &["a", "-bb1"],
            package_hint: "p7zip",
        }),
        _ => None,
    }
}

/// Picks a non-colliding archive path, appending " (n)" before the extension.
fn unique_archive_path(directory: &Path, stem: &str, extension: &str) -> PathBuf {
    let mut candidate = directory.join(format!("{}.{}", stem, extension));
    let mut counter = 1;

    while candidate.exists() {
        candidate = directory.join(format!("{} ({}).{}", stem, counter, extension));
        counter += 1;
    }

    candidate
}

/// Number of filesystem entries the archive will contain, used to turn the
/// tools' per-file output into a percentage.
fn count_entries(sources: &[PathBuf]) -> usize {
    sources
        .iter()
        .map(|source| {
            if source.is_dir() {
                WalkDir::new(source)
                    .follow_links(false)
                    .into_iter()
                    .filter_map(Result::ok)
                    .count()
            } else {
                1
            }
        })
        .sum::<usize>()
        .max(1)
}

/// Consumes a child's pipe on a background thread, counting the per-entry lines
/// the archiver prints so the supervisor loop can report progress.
fn spawn_line_counter<R: std::io::Read + Send + 'static>(
    stream: Option<R>,
    counter: Arc<AtomicUsize>,
) {
    let Some(stream) = stream else {
        return;
    };

    thread::spawn(move || {
        let reader = BufReader::new(stream);

        for line in reader.lines() {
            match line {
                Ok(_) => {
                    counter.fetch_add(1, Ordering::Relaxed);
                }
                Err(_) => break,
            }
        }
    });
}

fn kill_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
pub fn compress_items(
    source_paths: Vec<String>,
    destination_dir: String,
    archive_name: String,
    format: String,
    operation_id: Option<String>,
    app: AppHandle,
) -> CompressResult {
    if source_paths.is_empty() {
        return failure("No items to compress");
    }

    let Some(spec) = format_spec(&format) else {
        return failure(format!("Unsupported archive format: {}", format));
    };

    let stem = archive_name.trim();

    if stem.is_empty() {
        return failure("Archive name cannot be empty");
    }

    // The name is joined onto a directory, so refuse anything that could escape it.
    if stem.contains('/') || stem.contains('\\') || stem == ".." {
        return failure("Archive name contains invalid path separators");
    }

    let destination = Path::new(&destination_dir);

    if !destination.is_dir() {
        return failure(format!("Destination is not a directory: {}", destination_dir));
    }

    let sources: Vec<PathBuf> = source_paths.iter().map(PathBuf::from).collect();

    for source in &sources {
        if !source.exists() {
            return failure(format!("Source does not exist: {}", source.display()));
        }
    }

    // Every source must share a parent: that parent becomes the working
    // directory, which is what keeps the stored paths relative.
    let Some(parent) = sources[0].parent().map(Path::to_path_buf) else {
        return failure("Cannot determine the parent directory of the selection");
    };

    if sources
        .iter()
        .any(|source| source.parent().map(Path::to_path_buf) != Some(parent.clone()))
    {
        return failure("All selected items must be in the same directory to compress");
    }

    let names: Vec<String> = match sources
        .iter()
        .map(|source| {
            source
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
        })
        .collect::<Option<Vec<String>>>()
    {
        Some(names) => names,
        None => return failure("Invalid item name in selection"),
    };

    let archive_path = unique_archive_path(destination, stem, spec.extension);
    let total_entries = count_entries(&sources);

    let token = operation_id.as_ref().map(|id| register_operation(id));

    let mut command = Command::new(spec.program);
    command
        .current_dir(&parent)
        .args(spec.leading_args)
        .arg(&archive_path)
        .args(&names)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            if let Some(id) = &operation_id {
                unregister_operation(id);
            }

            return failure(format!(
                "Failed to run {}: {}. Is {} installed?",
                spec.program, error, spec.package_hint
            ));
        }
    };

    let counter = Arc::new(AtomicUsize::new(0));
    spawn_line_counter(child.stdout.take(), Arc::clone(&counter));
    spawn_line_counter(child.stderr.take(), Arc::clone(&counter));

    let mut cancelled = false;

    let status = loop {
        if is_cancelled(&token) {
            kill_and_reap(&mut child);
            cancelled = true;
            break None;
        }

        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                let processed = counter.load(Ordering::Relaxed).min(total_entries);
                emit_progress(
                    &app,
                    &operation_id,
                    "compress",
                    processed,
                    total_entries,
                    &archive_path.to_string_lossy(),
                );
                thread::sleep(POLL_INTERVAL);
            }
            Err(error) => {
                kill_and_reap(&mut child);

                if let Some(id) = &operation_id {
                    unregister_operation(id);
                }

                return failure(format!("Failed while waiting for {}: {}", spec.program, error));
            }
        }
    };

    emit_progress(
        &app,
        &operation_id,
        "compress",
        total_entries,
        total_entries,
        "",
    );

    if let Some(id) = &operation_id {
        unregister_operation(id);
    }

    if cancelled {
        // A killed archiver leaves a truncated file behind; don't keep it.
        let _ = std::fs::remove_file(&archive_path);

        return CompressResult {
            success: false,
            error: None,
            archive_path: None,
            cancelled: true,
        };
    }

    match status {
        Some(status) if status.success() => {
            undo::push(
                "compress",
                1,
                false,
                undo::UndoAction::RemoveCreated {
                    paths: vec![archive_path.clone()],
                },
            );

            CompressResult {
                success: true,
                error: None,
                archive_path: Some(archive_path.to_string_lossy().to_string()),
                cancelled: false,
            }
        }
        Some(status) => {
            let _ = std::fs::remove_file(&archive_path);

            failure(format!(
                "{} exited with status {}",
                spec.program,
                status.code().unwrap_or(-1)
            ))
        }
        None => failure(format!("{} did not complete", spec.program)),
    }
}
