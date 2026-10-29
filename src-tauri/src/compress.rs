use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Runtime};
use walkdir::WalkDir;

use crate::file_operations::{
    emit_progress, is_cancelled, register_operation, unregister_operation,
};
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
        "tar.zst" => Some(FormatSpec {
            extension: "tar.zst",
            program: "tar",
            leading_args: &["--zstd", "-cvf"],
            package_hint: "zstd",
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

/// Expande la selección a todas sus rutas (directorios y archivos), relativas
/// a `parent` y en orden de recorrido. cpio archiva exactamente lo que recibe
/// por stdin —no recursa solo—, así que necesita la lista completa.
pub(crate) fn collect_relative_entries(parent: &Path, names: &[String]) -> Vec<String> {
    let mut entries = Vec::new();

    for name in names {
        let root = parent.join(name);

        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if let Ok(relative) = entry.path().strip_prefix(parent) {
                entries.push(relative.to_string_lossy().to_string());
            }
        }
    }

    entries
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

/// Supervisa un `child` ya lanzado: reporta progreso contando las líneas que
/// el archivador imprime, atiende la cancelación y arma el `CompressResult`.
/// Es el tramo común a todos los formatos; `program` sólo nombra la herramienta
/// en los mensajes de error. En caso de fallo o cancelación borra el archivo a
/// medio escribir.
// Son los datos mínimos del proceso y de la operación; agruparlos en un struct
// sólo movería los mismos campos sin aclarar nada.
#[allow(clippy::too_many_arguments)]
fn supervise_compression<R: Runtime>(
    mut child: Child,
    counter: Arc<AtomicUsize>,
    token: Option<Arc<AtomicBool>>,
    operation_id: &Option<String>,
    app: &AppHandle<R>,
    archive_path: &Path,
    total_entries: usize,
    program: &str,
) -> CompressResult {
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
                    app,
                    operation_id,
                    "compress",
                    processed,
                    total_entries,
                    &archive_path.to_string_lossy(),
                );
                thread::sleep(POLL_INTERVAL);
            }
            Err(error) => {
                kill_and_reap(&mut child);

                if let Some(id) = operation_id {
                    unregister_operation(id);
                }

                let _ = std::fs::remove_file(archive_path);

                return failure(format!("Failed while waiting for {}: {}", program, error));
            }
        }
    };

    emit_progress(
        app,
        operation_id,
        "compress",
        total_entries,
        total_entries,
        "",
    );

    if let Some(id) = operation_id {
        unregister_operation(id);
    }

    if cancelled {
        // A killed archiver leaves a truncated file behind; don't keep it.
        let _ = std::fs::remove_file(archive_path);

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
                    paths: vec![archive_path.to_path_buf()],
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
            let _ = std::fs::remove_file(archive_path);

            failure(format!(
                "{} exited with status {}",
                program,
                status.code().unwrap_or(-1)
            ))
        }
        None => failure(format!("{} did not complete", program)),
    }
}

/// Camino propio de cpio: lee la lista de rutas por stdin y escribe el archivo
/// por stdout, así que no pasa por el `FormatSpec` genérico.
fn compress_cpio<R: Runtime>(
    parent: &Path,
    names: &[String],
    destination: &Path,
    stem: &str,
    total_entries: usize,
    operation_id: Option<String>,
    app: &AppHandle<R>,
) -> CompressResult {
    let archive_path = unique_archive_path(destination, stem, "cpio");

    let file = match std::fs::File::create(&archive_path) {
        Ok(file) => file,
        Err(error) => return failure(format!("Failed to create archive file: {}", error)),
    };

    let token = operation_id.as_ref().map(|id| register_operation(id));

    let mut command = Command::new("cpio");
    command
        .current_dir(parent)
        // `--null`: la lista de rutas entra NUL-separada, no por líneas. Un nombre
        // de archivo con un `\n` partiría la línea y ese archivo quedaría sin
        // archivar (pérdida silenciosa); con NUL cualquier nombre va entero.
        .args(["-o", "-H", "newc", "--null"])
        .stdin(Stdio::piped())
        .stdout(Stdio::from(file))
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            if let Some(id) = &operation_id {
                unregister_operation(id);
            }

            let _ = std::fs::remove_file(&archive_path);

            return failure(format!("Failed to run cpio: {}. Is cpio installed?", error));
        }
    };

    // Alimenta las rutas (NUL-separadas, ver `--null`) en un hilo para no trabar el
    // pipe si la selección es grande, y cierra stdin al terminar para que cpio
    // finalice.
    if let Some(mut stdin) = child.stdin.take() {
        let entries = collect_relative_entries(parent, names);

        thread::spawn(move || {
            for entry in entries {
                if stdin.write_all(entry.as_bytes()).is_err() || stdin.write_all(b"\0").is_err() {
                    break;
                }
            }
        });
    }

    let counter = Arc::new(AtomicUsize::new(0));
    spawn_line_counter(child.stderr.take(), Arc::clone(&counter));

    supervise_compression(
        child,
        counter,
        token,
        &operation_id,
        app,
        &archive_path,
        total_entries,
        "cpio",
    )
}

#[tauri::command]
pub fn compress_items(
    source_paths: Vec<String>,
    destination_dir: String,
    archive_name: String,
    format: String,
    password: Option<String>,
    operation_id: Option<String>,
    app: AppHandle,
) -> CompressResult {
    compress_items_impl(
        source_paths,
        destination_dir,
        archive_name,
        format,
        password,
        operation_id,
        &app,
    )
}

/// El comando de verdad, genérico en el runtime para poder correrlo contra
/// `tauri::test::mock_app()` en las pruebas.
pub(crate) fn compress_items_impl<R: Runtime>(
    source_paths: Vec<String>,
    destination_dir: String,
    archive_name: String,
    format: String,
    password: Option<String>,
    operation_id: Option<String>,
    app: &AppHandle<R>,
) -> CompressResult {
    if source_paths.is_empty() {
        return failure("No items to compress");
    }

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
        return failure(format!(
            "Destination is not a directory: {}",
            destination_dir
        ));
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

    let total_entries = count_entries(&sources);

    // Una clave vacía es como no traer clave. Sólo cifra 7z; el frontend no la
    // ofrece para los demás formatos, pero si llegara igual, se ignora.
    let password = password.filter(|value| !value.is_empty());

    if format == "cpio" {
        return compress_cpio(
            &parent,
            &names,
            destination,
            stem,
            total_entries,
            operation_id,
            app,
        );
    }

    let Some(spec) = format_spec(&format) else {
        return failure(format!("Unsupported archive format: {}", format));
    };

    let archive_path = unique_archive_path(destination, stem, spec.extension);

    let encrypt_7z = format == "7z" && password.is_some();

    let token = operation_id.as_ref().map(|id| register_operation(id));

    let mut command = Command::new(spec.program);
    command.current_dir(&parent).args(spec.leading_args);

    if encrypt_7z {
        // Cifra contenido y encabezados; la clave NUNCA va en argv, va por stdin.
        command.arg("-mhe=on").arg("-p");
    }

    // El `--` corta el análisis de flags: un nombre que empieza con `-` no se
    // confunde con una opción. zip, tar y 7z lo aceptan en esta posición.
    command
        .arg(&archive_path)
        .arg("--")
        .args(&names)
        .stdin(if encrypt_7z {
            Stdio::piped()
        } else {
            Stdio::null()
        })
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

    if encrypt_7z {
        // 7z pide la clave una sola vez al crear. Un error de escritura no es
        // fatal: el proceso lo reportará y la supervisión lo recoge.
        if let (Some(mut stdin), Some(pass)) = (child.stdin.take(), password.as_ref()) {
            let _ = stdin.write_all(pass.as_bytes());
            let _ = stdin.write_all(b"\n");
        }
    }

    let counter = Arc::new(AtomicUsize::new(0));
    spawn_line_counter(child.stdout.take(), Arc::clone(&counter));
    spawn_line_counter(child.stderr.take(), Arc::clone(&counter));

    supervise_compression(
        child,
        counter,
        token,
        &operation_id,
        app,
        &archive_path,
        total_entries,
        spec.program,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{extract_archive, list_archive};
    use crate::polkit::testing::{cleanup, running_as_root, scratch};
    use std::collections::BTreeMap;
    use std::sync::Mutex;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::{App, Listener};

    type Eventos = Arc<Mutex<Vec<serde_json::Value>>>;

    fn texto(ruta: &Path) -> String {
        ruta.to_string_lossy().into_owned()
    }

    /// Comprimir apila una entrada de deshacer, y esa pila es del proceso: quien
    /// corra una compresión entera toma el mismo candado que las pruebas de `undo`.
    fn pilas() -> std::sync::MutexGuard<'static, ()> {
        crate::undo::tests::CANDADO_PILAS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    fn escuchar(app: &App<MockRuntime>) -> Eventos {
        let eventos: Eventos = Arc::new(Mutex::new(Vec::new()));
        let guardados = eventos.clone();
        app.listen("file-operation-progress", move |evento| {
            guardados
                .lock()
                .unwrap()
                .push(serde_json::from_str(evento.payload()).unwrap());
        });
        eventos
    }

    /// Todo lo que cuelga de `raiz`: ruta relativa → contenido de cada archivo.
    fn arbol(raiz: &Path) -> BTreeMap<String, String> {
        walkdir::WalkDir::new(raiz)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entrada| entrada.file_type().is_file())
            .map(|entrada| {
                (
                    texto(entrada.path().strip_prefix(raiz).unwrap()),
                    std::fs::read_to_string(entrada.path()).unwrap(),
                )
            })
            .collect()
    }

    /// `origen/` con un archivo suelto y una carpeta con una subcarpeta.
    fn origen_de_ejemplo(base: &Path) -> PathBuf {
        let origen = base.join("origen");
        std::fs::create_dir_all(origen.join("carpeta/sub")).unwrap();
        std::fs::write(origen.join("suelto.txt"), "archivo suelto").unwrap();
        std::fs::write(origen.join("carpeta/uno.txt"), "uno").unwrap();
        std::fs::write(origen.join("carpeta/sub/dos.txt"), "dos con ñ y tildes áé").unwrap();
        origen
    }

    fn comprimir(
        app: &App<MockRuntime>,
        origen: &Path,
        nombres: &[&str],
        destino: &Path,
        formato: &str,
        clave: Option<&str>,
    ) -> CompressResult {
        compress_items_impl(
            nombres.iter().map(|n| texto(&origen.join(n))).collect(),
            texto(destino),
            "paquete".into(),
            formato.into(),
            clave.map(String::from),
            None,
            app.handle(),
        )
    }

    // --- collect_relative_entries ---------------------------------------------

    #[test]
    fn la_seleccion_se_expande_a_rutas_relativas_recursivas() {
        let base = scratch("comp-recolectar-expande");
        let origen = origen_de_ejemplo(&base);

        let mut rutas =
            collect_relative_entries(&origen, &["carpeta".to_string(), "suelto.txt".to_string()]);

        rutas.sort();
        assert_eq!(
            rutas,
            vec![
                "carpeta",
                "carpeta/sub",
                "carpeta/sub/dos.txt",
                "carpeta/uno.txt",
                "suelto.txt",
            ]
        );
        cleanup(&base);
    }

    #[test]
    fn la_expansion_incluye_las_carpetas_vacias_y_no_sigue_enlaces() {
        let base = scratch("comp-recolectar-vacias");
        let origen = base.join("origen");
        std::fs::create_dir_all(origen.join("carpeta/vacia")).unwrap();
        std::fs::create_dir_all(base.join("afuera")).unwrap();
        std::fs::write(base.join("afuera/secreto.txt"), "x").unwrap();
        std::os::unix::fs::symlink(base.join("afuera"), origen.join("carpeta/enlace")).unwrap();

        let mut rutas = collect_relative_entries(&origen, &["carpeta".into()]);

        rutas.sort();
        // El enlace va como entrada propia; lo que hay detrás no se recorre.
        assert_eq!(rutas, vec!["carpeta", "carpeta/enlace", "carpeta/vacia"]);
        cleanup(&base);
    }

    #[test]
    fn una_seleccion_que_no_existe_no_aporta_rutas() {
        let base = scratch("comp-recolectar-inexistente");

        let rutas = collect_relative_entries(&base, &["no-esta".to_string()]);

        assert!(rutas.is_empty());
        cleanup(&base);
    }

    // --- Ida y vuelta de cada formato ----------------------------------------------

    #[test]
    fn todos_los_formatos_vuelven_con_los_mismos_contenidos() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-ida-y-vuelta");
        let origen = origen_de_ejemplo(&base);
        let esperado = BTreeMap::from([
            (
                "carpeta/sub/dos.txt".to_string(),
                "dos con ñ y tildes áé".to_string(),
            ),
            ("carpeta/uno.txt".to_string(), "uno".to_string()),
            ("suelto.txt".to_string(), "archivo suelto".to_string()),
        ]);

        for formato in [
            "zip", "tar.gz", "tar.xz", "tar.bz2", "tar", "tar.zst", "7z", "cpio",
        ] {
            let salida = base.join(format!("salida-{formato}"));
            let destino = base.join(format!("extraido-{formato}"));
            std::fs::create_dir_all(&salida).unwrap();
            std::fs::create_dir_all(&destino).unwrap();

            let resultado = comprimir(
                &app,
                &origen,
                &["carpeta", "suelto.txt"],
                &salida,
                formato,
                None,
            );

            assert!(resultado.success, "{formato}: {:?}", resultado.error);
            let archivo = resultado.archive_path.expect("ruta del archivo creado");
            assert!(
                archivo.ends_with(&format!("paquete.{formato}")),
                "{archivo}"
            );

            let extraido = extract_archive(archivo, texto(&destino), None);

            assert!(extraido.is_ok(), "{formato}: {extraido:?}");
            assert_eq!(arbol(&destino), esperado, "{formato}");
        }
        cleanup(&base);
    }

    #[test]
    fn un_tar_zst_comprimido_se_lista_con_sus_nombres() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-zst-lista");
        let origen = origen_de_ejemplo(&base);

        let resultado = comprimir(&app, &origen, &["suelto.txt"], &base, "tar.zst", None);

        let archivo = resultado.archive_path.expect("archivo creado");
        assert!(archivo.ends_with(".tar.zst"));
        assert_eq!(list_archive(archivo, None).unwrap(), vec!["suelto.txt"]);
        cleanup(&base);
    }

    #[test]
    fn un_cpio_comprimido_se_lista_con_todas_sus_rutas() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-cpio-lista");
        let origen = origen_de_ejemplo(&base);

        let resultado = comprimir(&app, &origen, &["carpeta"], &base, "cpio", None);

        let mut nombres =
            list_archive(resultado.archive_path.expect("archivo creado"), None).unwrap();
        nombres.sort();
        assert_eq!(
            nombres,
            vec![
                "carpeta",
                "carpeta/sub",
                "carpeta/sub/dos.txt",
                "carpeta/uno.txt"
            ]
        );
        cleanup(&base);
    }

    #[test]
    fn un_cpio_archiva_un_nombre_con_salto_de_linea_entero() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-cpio-salto-de-linea");
        let origen = base.join("origen");
        let destino = base.join("destino");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::create_dir_all(&destino).unwrap();
        // Con la lista separada por `\n` este nombre se partía en dos rutas que no
        // existen y el archivo se perdía sin avisar.
        std::fs::write(origen.join("raro\nnombre.txt"), "no se pierde").unwrap();
        std::fs::write(origen.join("normal.txt"), "normal").unwrap();

        let resultado = comprimir(
            &app,
            &origen,
            &["raro\nnombre.txt", "normal.txt"],
            &base,
            "cpio",
            None,
        );

        assert!(resultado.success, "{:?}", resultado.error);
        let extraido = extract_archive(resultado.archive_path.unwrap(), texto(&destino), None);
        assert!(extraido.is_ok(), "{extraido:?}");
        assert_eq!(
            arbol(&destino),
            BTreeMap::from([
                ("normal.txt".to_string(), "normal".to_string()),
                ("raro\nnombre.txt".to_string(), "no se pierde".to_string()),
            ])
        );
        cleanup(&base);
    }

    #[test]
    fn un_nombre_que_empieza_con_guion_no_se_confunde_con_una_opcion() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-nombre-con-guion");
        let origen = base.join("origen");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::write(origen.join("-r"), "no soy una opción").unwrap();

        for formato in ["zip", "tar.gz", "tar.zst", "7z"] {
            let salida = base.join(format!("salida-{formato}"));
            let destino = base.join(format!("extraido-{formato}"));
            std::fs::create_dir_all(&salida).unwrap();
            std::fs::create_dir_all(&destino).unwrap();

            let resultado = comprimir(&app, &origen, &["-r"], &salida, formato, None);

            assert!(resultado.success, "{formato}: {:?}", resultado.error);
            extract_archive(resultado.archive_path.unwrap(), texto(&destino), None).unwrap();
            assert_eq!(
                arbol(&destino),
                BTreeMap::from([("-r".to_string(), "no soy una opción".to_string())]),
                "{formato}"
            );
        }
        cleanup(&base);
    }

    #[test]
    fn el_nombre_del_archivo_no_pisa_uno_existente() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-nombre-ocupado");
        let origen = origen_de_ejemplo(&base);
        let salida = base.join("salida");
        std::fs::create_dir_all(&salida).unwrap();
        std::fs::write(salida.join("paquete.tar.zst"), "otro").unwrap();

        let resultado = comprimir(&app, &origen, &["suelto.txt"], &salida, "tar.zst", None);

        assert!(resultado
            .archive_path
            .unwrap()
            .ends_with("paquete (1).tar.zst"));
        assert_eq!(
            std::fs::read_to_string(salida.join("paquete.tar.zst")).unwrap(),
            "otro"
        );
        cleanup(&base);
    }

    // --- Contraseña (7z) ---------------------------------------------------------------

    #[test]
    fn un_7z_con_clave_no_se_lista_ni_se_extrae_sin_ella() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-7z-clave");
        let origen = origen_de_ejemplo(&base);
        let destino = base.join("destino");
        std::fs::create_dir_all(&destino).unwrap();

        let resultado = comprimir(&app, &origen, &["carpeta"], &base, "7z", Some("clave"));

        assert!(resultado.success, "{:?}", resultado.error);
        let archivo = resultado.archive_path.unwrap();

        // Sin clave: ni siquiera los nombres se ven (`-mhe=on`).
        assert_eq!(
            list_archive(archivo.clone(), None).unwrap_err(),
            "ENCRYPTED"
        );
        assert_eq!(
            extract_archive(archivo.clone(), texto(&destino), None).unwrap_err(),
            "ENCRYPTED"
        );
        // Con una clave que no es: se distingue de «falta la clave».
        assert_eq!(
            list_archive(archivo.clone(), Some("otra".into())).unwrap_err(),
            "WRONG_PASSWORD"
        );
        assert_eq!(
            extract_archive(archivo.clone(), texto(&destino), Some("otra".into())).unwrap_err(),
            "WRONG_PASSWORD"
        );
        assert!(arbol(&destino).is_empty(), "no debía extraerse nada");

        // Con la correcta, lista y extrae.
        let mut nombres = list_archive(archivo.clone(), Some("clave".into())).unwrap();
        nombres.sort();
        assert_eq!(
            nombres,
            vec![
                "carpeta",
                "carpeta/sub",
                "carpeta/sub/dos.txt",
                "carpeta/uno.txt"
            ]
        );
        extract_archive(archivo, texto(&destino), Some("clave".into())).unwrap();
        assert_eq!(
            arbol(&destino).keys().cloned().collect::<Vec<_>>(),
            vec!["carpeta/sub/dos.txt", "carpeta/uno.txt"]
        );
        cleanup(&base);
    }

    #[test]
    fn el_contenido_de_un_7z_con_clave_no_se_lee_en_claro() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-7z-cifrado-de-verdad");
        let origen = base.join("origen");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::write(
            origen.join("nota.txt"),
            "TEXTO-RECONOCIBLE-EN-CLARO".repeat(20),
        )
        .unwrap();

        let resultado = comprimir(&app, &origen, &["nota.txt"], &base, "7z", Some("clave"));

        let bytes = std::fs::read(resultado.archive_path.unwrap()).unwrap();
        assert!(!bytes.windows(10).any(|ventana| ventana == b"TEXTO-RECO"));
        assert!(!bytes.windows(8).any(|ventana| ventana == b"nota.txt"));
        cleanup(&base);
    }

    #[test]
    fn un_7z_con_clave_vacia_sale_sin_cifrar() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-7z-clave-vacia");
        let origen = origen_de_ejemplo(&base);

        let resultado = comprimir(&app, &origen, &["suelto.txt"], &base, "7z", Some(""));

        assert!(resultado.success, "{:?}", resultado.error);
        assert_eq!(
            list_archive(resultado.archive_path.unwrap(), None).unwrap(),
            vec!["suelto.txt"]
        );
        cleanup(&base);
    }

    #[test]
    fn la_clave_se_ignora_en_los_formatos_que_no_cifran() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-clave-ignorada");
        let origen = origen_de_ejemplo(&base);

        for formato in ["zip", "tar.gz", "tar.zst", "cpio"] {
            let salida = base.join(format!("salida-{formato}"));
            std::fs::create_dir_all(&salida).unwrap();

            let resultado = comprimir(
                &app,
                &origen,
                &["suelto.txt"],
                &salida,
                formato,
                Some("clave"),
            );

            assert!(resultado.success, "{formato}: {:?}", resultado.error);
            // Si la clave se hubiera tomado por un argumento de más, no se listaría sin ella.
            assert_eq!(
                list_archive(resultado.archive_path.unwrap(), None).unwrap(),
                vec!["suelto.txt"],
                "{formato}"
            );
        }
        cleanup(&base);
    }

    // --- Validaciones de entrada ---------------------------------------------------------

    #[test]
    fn comprimir_valida_la_entrada_antes_de_lanzar_nada() {
        let app = mock_app();
        let base = scratch("comp-validaciones");
        let origen = origen_de_ejemplo(&base);
        let otra = base.join("otra");
        std::fs::create_dir_all(&otra).unwrap();
        std::fs::write(otra.join("x.txt"), "x").unwrap();
        let suelto = texto(&origen.join("suelto.txt"));
        let pedir = |fuentes: Vec<String>, destino: &Path, nombre: &str, formato: &str| {
            compress_items_impl(
                fuentes,
                texto(destino),
                nombre.into(),
                formato.into(),
                None,
                None,
                app.handle(),
            )
        };

        let sin_nada = pedir(vec![], &base, "x", "zip");
        let nombre_vacio = pedir(vec![suelto.clone()], &base, "   ", "zip");
        let nombre_con_barra = pedir(vec![suelto.clone()], &base, "a/b", "zip");
        let nombre_con_punto_punto = pedir(vec![suelto.clone()], &base, "..", "zip");
        let destino_no_es_carpeta =
            pedir(vec![suelto.clone()], &origen.join("suelto.txt"), "x", "zip");
        let fuente_inexistente = pedir(vec![texto(&base.join("no-esta"))], &base, "x", "zip");
        let padres_distintos = pedir(
            vec![suelto.clone(), texto(&otra.join("x.txt"))],
            &base,
            "x",
            "zip",
        );
        let formato_raro = pedir(vec![suelto], &base, "x", "rar");

        assert_eq!(sin_nada.error.as_deref(), Some("No items to compress"));
        assert_eq!(
            nombre_vacio.error.as_deref(),
            Some("Archive name cannot be empty")
        );
        for resultado in [&nombre_con_barra, &nombre_con_punto_punto] {
            assert_eq!(
                resultado.error.as_deref(),
                Some("Archive name contains invalid path separators")
            );
        }
        assert!(destino_no_es_carpeta
            .error
            .unwrap()
            .starts_with("Destination is not a directory"));
        assert!(fuente_inexistente
            .error
            .unwrap()
            .starts_with("Source does not exist"));
        assert_eq!(
            padres_distintos.error.as_deref(),
            Some("All selected items must be in the same directory to compress")
        );
        assert_eq!(
            formato_raro.error.as_deref(),
            Some("Unsupported archive format: rar")
        );
        for resultado in [sin_nada, nombre_vacio, nombre_con_barra, formato_raro] {
            assert!(!resultado.success && resultado.archive_path.is_none() && !resultado.cancelled);
        }
        cleanup(&base);
    }

    // --- Avance, cancelación y fallo ---------------------------------------------------------

    #[test]
    fn comprimir_con_id_emite_el_avance_y_cierra_en_el_total() {
        let _pilas = pilas();
        let app = mock_app();
        let eventos = escuchar(&app);
        let base = scratch("comp-avance");
        let origen = origen_de_ejemplo(&base);

        for formato in ["tar.zst", "cpio"] {
            eventos.lock().unwrap().clear();

            let resultado = compress_items_impl(
                vec![texto(&origen.join("carpeta"))],
                texto(&base),
                format!("avance-{formato}"),
                formato.into(),
                None,
                Some(format!("op-{formato}")),
                app.handle(),
            );

            assert!(resultado.success, "{formato}: {:?}", resultado.error);
            let emitidos = eventos.lock().unwrap().clone();
            let ultimo = emitidos.last().expect("al menos el evento final");
            assert_eq!(ultimo["operation_id"], format!("op-{formato}"));
            assert_eq!(ultimo["kind"], "compress");
            // `carpeta`, `carpeta/sub`, y los dos archivos.
            assert_eq!(ultimo["total"], 4, "{formato}");
            assert_eq!(ultimo["processed"], 4, "{formato}");
        }
        cleanup(&base);
    }

    /// Bytes que no comprimen, para que el compresor tarde lo suficiente.
    fn incomprimible(bytes: usize) -> Vec<u8> {
        let mut estado: u64 = 0x9E37_79B9_7F4A_7C15;
        (0..bytes)
            .map(|_| {
                estado ^= estado << 13;
                estado ^= estado >> 7;
                estado ^= estado << 17;
                (estado >> 24) as u8
            })
            .collect()
    }

    #[test]
    fn cancelar_a_mitad_de_la_compresion_no_deja_un_archivo_a_medio_escribir() {
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-cancelar");
        let origen = base.join("origen");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::write(origen.join("grande.bin"), incomprimible(24 * 1024 * 1024)).unwrap();
        let id = "compresion-a-cancelar";

        // `compress_items_impl` registra el id al arrancar: quien cancela insiste
        // hasta que el comando ya lo conoce.
        let cancelador = thread::spawn(move || {
            let limite = std::time::Instant::now() + Duration::from_secs(20);
            while std::time::Instant::now() < limite {
                if crate::file_operations::cancel_file_operation(id.to_string()) {
                    return true;
                }
                thread::sleep(Duration::from_millis(1));
            }
            false
        });

        let resultado = compress_items_impl(
            vec![texto(&origen.join("grande.bin"))],
            texto(&base),
            "cancelada".into(),
            "tar.xz".into(),
            None,
            Some(id.into()),
            app.handle(),
        );

        assert!(
            cancelador.join().unwrap(),
            "el comando nunca registró la operación"
        );
        assert!(resultado.cancelled, "{:?}", resultado.error);
        assert!(!resultado.success);
        assert!(resultado.archive_path.is_none());
        assert!(!base.join("cancelada.tar.xz").exists());
        cleanup(&base);
    }

    #[test]
    fn si_el_archivador_falla_se_avisa_y_se_borra_el_archivo_parcial() {
        if running_as_root() {
            // Como root nada es ilegible: no hay forma de hacer fallar a `tar`.
            return;
        }
        let _pilas = pilas();
        let app = mock_app();
        let base = scratch("comp-archivador-falla");
        let origen = base.join("origen");
        std::fs::create_dir_all(&origen).unwrap();
        std::fs::write(origen.join("cerrado.txt"), "x").unwrap();
        std::fs::set_permissions(
            origen.join("cerrado.txt"),
            std::os::unix::fs::PermissionsExt::from_mode(0o000),
        )
        .unwrap();

        let resultado = comprimir(&app, &origen, &["cerrado.txt"], &base, "tar", None);

        assert!(!resultado.success);
        assert!(!resultado.cancelled);
        assert!(resultado.archive_path.is_none());
        assert!(resultado
            .error
            .unwrap()
            .starts_with("tar exited with status"),);
        assert!(
            !base.join("paquete.tar").exists(),
            "no debía quedar el parcial"
        );
        cleanup(&base);
    }
}
