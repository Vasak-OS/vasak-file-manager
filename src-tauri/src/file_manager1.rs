//! La interfaz `org.freedesktop.FileManager1` y el ruteo de una ruta a la
//! ventana que ya está abierta.
//!
//! Es el contrato estándar de freedesktop para «mostrar esto en el gestor de
//! archivos»: lo hablan GTK, los navegadores y cualquier app que quiera abrir
//! una carpeta o resaltar un archivo. Sin él, «mostrar en la carpeta» no hacía
//! nada, y cada invocación por línea de comandos abría una ventana nueva en vez
//! de sumar una pestaña a la que ya estaba.
//!
//! Las dos puertas —el bus y la instancia única— terminan en lo mismo: resolver
//! lo que pidieron a un directorio que existe (reusando `startup_path`) y
//! avisarle al frontend para que lo abra en una pestaña nueva, al frente.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::startup_path;

/// El nombre de bus, la ruta de objeto y el nombre de la interfaz, tal como los
/// fija freedesktop.
const BUS_NAME: &str = "org.freedesktop.FileManager1";
const OBJECT_PATH: &str = "/org/freedesktop/FileManager1";

/// El evento que escucha el frontend para abrir cada ruta en una pestaña.
const OPEN_PATHS_EVENT: &str = "open-paths";

/// Resuelve cada URI a un directorio y, si hay alguno, lo rutea a la ventana.
///
/// Devuelve las rutas resueltas sólo para que las pruebas puedan comprobar el
/// mapeo sin un bus ni una ventana de por medio.
fn resolve_uris(uris: &[String]) -> Vec<PathBuf> {
    uris.iter()
        .filter_map(|uri| startup_path::resolve(uri))
        .collect()
}

/// Lleva al frente la ventana principal y le pide al frontend que abra cada
/// ruta en una pestaña nueva.
///
/// El foco es con lo que da Tauri: bajo Wayfire `set_focus` devuelve `Ok` y el
/// compositor lo ignora, así que la ventana puede no levantarse sola; traerla al
/// frente de verdad es trabajo del compositor y queda fuera de acá.
pub fn route<R: Runtime>(app: &AppHandle<R>, paths: &[PathBuf]) {
    if paths.is_empty() {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    let as_strings: Vec<String> = paths
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    let _ = app.emit(OPEN_PATHS_EVENT, as_strings);
}

struct FileManager1<R: Runtime> {
    app: AppHandle<R>,
}

#[zbus::interface(name = "org.freedesktop.FileManager1")]
impl<R: Runtime> FileManager1<R> {
    /// Abre cada carpeta en una pestaña. Las URIs ya son directorios.
    fn show_folders(&self, uris: Vec<String>, _startup_id: String) {
        route(&self.app, &resolve_uris(&uris));
    }

    /// Resalta cada archivo: `startup_path::resolve` devuelve la carpeta que lo
    /// contiene, que es lo que se abre.
    fn show_items(&self, uris: Vec<String>, _startup_id: String) {
        route(&self.app, &resolve_uris(&uris));
    }

    /// No hay una vista de propiedades a la que llegar por el bus; lo honesto es
    /// abrir la carpeta que contiene el elemento, como `ShowItems`.
    fn show_item_properties(&self, uris: Vec<String>, _startup_id: String) {
        route(&self.app, &resolve_uris(&uris));
    }
}

/// Registra el nombre de bus y sirve la interfaz hasta que el proceso termina.
///
/// Si el nombre ya tiene dueño —otro gestor de archivos corriendo— falla el
/// registro y se devuelve el error: no es fatal, el gestor anda igual, sólo que
/// «mostrar en la carpeta» irá a ese otro. Mantener viva la conexión es lo que
/// deja la interfaz publicada, así que la función no retorna mientras el bus
/// esté arriba.
pub async fn serve(app: AppHandle) -> zbus::Result<()> {
    let _connection = zbus::connection::Builder::session()?
        .name(BUS_NAME)?
        .serve_at(OBJECT_PATH, FileManager1 { app })?
        .build()
        .await?;

    // La conexión se cierra al soltarse: pending la mantiene en alcance.
    std::future::pending::<()>().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tauri::Listener;

    use std::path::Path;

    use super::*;

    fn temporal(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vasak-fm1-{nombre}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Las URIs de carpeta se resuelven tal cual; `ShowFolders` abre eso.
    #[test]
    fn resuelve_uris_de_carpeta() {
        let dir = temporal("carpeta");
        let uri = format!("file://{}", dir.to_str().unwrap());
        assert_eq!(resolve_uris(&[uri]), vec![dir]);
    }

    /// `ShowItems` llega con el archivo: lo que se abre es la carpeta que lo
    /// contiene, no el archivo.
    #[test]
    fn un_item_se_resuelve_a_su_carpeta() {
        let dir = temporal("con-item");
        let archivo = dir.join("foto.png");
        std::fs::write(&archivo, b"").unwrap();
        let uri = format!("file://{}", archivo.to_str().unwrap());
        assert_eq!(resolve_uris(&[uri]), vec![dir]);
    }

    /// Sin URIs no hay nada que abrir.
    #[test]
    fn sin_uris_no_hay_rutas() {
        assert_eq!(resolve_uris(&[]), Vec::<PathBuf>::new());
    }

    /// Varias URIs llegan en el orden pedido: cada una es una pestaña y la
    /// última queda al frente.
    #[test]
    fn conserva_el_orden_de_las_uris() {
        let primera = temporal("orden-a");
        let segunda = temporal("orden-b");
        let uris = [
            format!("file://{}", segunda.to_str().unwrap()),
            format!("file://{}", primera.to_str().unwrap()),
        ];
        assert_eq!(resolve_uris(&uris), vec![segunda, primera]);
    }

    /// Los nombres con espacios llegan escapados en la URI y hay que
    /// deshacerlo, o la carpeta «no existe».
    #[test]
    fn deshace_el_escapado_de_la_uri() {
        let dir = temporal("con espacio");
        let uri = format!("file://{}", dir.to_str().unwrap().replace(' ', "%20"));
        assert_eq!(resolve_uris(&[uri]), vec![dir]);
    }

    /// Una URI que no es `file://` (un `https://`, un `smb://`) no se abre
    /// localmente.
    #[test]
    fn descarta_las_uris_remotas() {
        let remotas = [
            "https://example.com/a".to_string(),
            "smb://equipo/a".to_string(),
        ];
        assert_eq!(resolve_uris(&remotas), Vec::<PathBuf>::new());
    }

    /// Los nombres son contrato con terceros: el bus y la ruta los fija
    /// freedesktop, y el evento lo escucha `App.vue` por su nombre literal.
    #[test]
    fn los_nombres_del_contrato_no_cambian() {
        assert_eq!(BUS_NAME, "org.freedesktop.FileManager1");
        assert_eq!(OBJECT_PATH, "/org/freedesktop/FileManager1");
        assert_eq!(OPEN_PATHS_EVENT, "open-paths");
    }

    /// Lo que se emite es lo que el frontend recibe en `open-paths`.
    fn rutas_emitidas(paths: &[PathBuf]) -> Vec<String> {
        let app = tauri::test::mock_app();
        let recibido = Arc::new(Mutex::new(Vec::<String>::new()));
        let guardado = recibido.clone();
        app.listen(OPEN_PATHS_EVENT, move |evento| {
            guardado.lock().unwrap().push(evento.payload().to_string());
        });

        route(app.handle(), paths);

        // El evento del mock se entrega en el acto, en el mismo hilo.
        let recibido = recibido.lock().unwrap();
        recibido.clone()
    }

    #[test]
    fn route_emite_open_paths_con_todas_las_rutas() {
        let emitidos = rutas_emitidas(&[PathBuf::from("/a"), PathBuf::from("/b c")]);
        assert_eq!(emitidos, vec![r#"["/a","/b c"]"#.to_string()]);
    }

    /// Sin rutas no se levanta ventana ni se avisa: un `ShowFolders([])` no
    /// puede abrir una pestaña vacía.
    /// Llama a un método del bus, sin bus, sobre un `AppHandle` de mentira, con
    /// `uri`, y devuelve lo que salió por `open-paths`.
    fn por_el_bus(
        uri: String,
        metodo: impl Fn(&FileManager1<tauri::test::MockRuntime>, Vec<String>),
    ) -> Vec<String> {
        let app = tauri::test::mock_app();
        let recibido = Arc::new(Mutex::new(Vec::<String>::new()));
        let guardado = recibido.clone();
        app.listen(OPEN_PATHS_EVENT, move |evento| {
            guardado.lock().unwrap().push(evento.payload().to_string());
        });
        let bus = FileManager1 {
            app: app.handle().clone(),
        };

        metodo(&bus, vec![uri]);

        let emitidos = recibido.lock().unwrap();
        emitidos.clone()
    }

    fn carpeta_con_archivo(nombre: &str) -> (PathBuf, String, String) {
        let dir = temporal(nombre);
        let archivo = dir.join("a.txt");
        std::fs::write(&archivo, b"").unwrap();
        let uri_dir = format!("file://{}", dir.to_str().unwrap());
        let uri_archivo = format!("file://{}", archivo.to_str().unwrap());
        (dir, uri_dir, uri_archivo)
    }

    fn json_de(dir: &Path) -> String {
        serde_json::to_string(&[dir.to_str().unwrap()]).unwrap()
    }

    #[test]
    fn show_folders_abre_la_carpeta() {
        let (dir, uri_dir, _) = carpeta_con_archivo("bus-folders");
        let emitidos = por_el_bus(uri_dir, |bus, uris| bus.show_folders(uris, String::new()));
        assert_eq!(emitidos, vec![json_de(&dir)]);
    }

    #[test]
    fn show_items_abre_la_carpeta_que_contiene_el_archivo() {
        let (dir, _, uri_archivo) = carpeta_con_archivo("bus-items");
        let emitidos = por_el_bus(uri_archivo, |bus, uris| bus.show_items(uris, String::new()));
        assert_eq!(emitidos, vec![json_de(&dir)]);
    }

    #[test]
    fn show_item_properties_abre_la_carpeta_que_contiene_el_archivo() {
        let (dir, _, uri_archivo) = carpeta_con_archivo("bus-props");
        let emitidos = por_el_bus(uri_archivo, |bus, uris| {
            bus.show_item_properties(uris, String::new())
        });
        assert_eq!(emitidos, vec![json_de(&dir)]);
    }

    /// Una URI que no se puede abrir no levanta la ventana ni emite.
    #[test]
    fn un_metodo_del_bus_con_una_uri_rota_no_emite() {
        let emitidos = por_el_bus("file:///no/existe/nada".into(), |bus, uris| {
            bus.show_folders(uris, String::new())
        });
        assert!(emitidos.is_empty());
    }

    #[test]
    fn route_sin_rutas_no_emite_nada() {
        assert!(rutas_emitidas(&[]).is_empty());
    }

    /// La ventana principal, si existe, se des-minimiza y se enfoca; y aun así
    /// el evento sale.
    #[test]
    fn route_con_la_ventana_principal_tambien_emite() {
        let app = tauri::test::mock_app();
        tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        let recibido = Arc::new(Mutex::new(0));
        let contador = recibido.clone();
        app.listen(OPEN_PATHS_EVENT, move |_| {
            *contador.lock().unwrap() += 1;
        });

        route(app.handle(), &[PathBuf::from("/a")]);

        assert_eq!(*recibido.lock().unwrap(), 1);
    }

    /// Lo que no existe no aporta ruta, y el resto sí: una URI rota no tira abajo
    /// las buenas.
    #[test]
    fn descarta_lo_que_no_se_puede_abrir() {
        let dir = temporal("mezcla");
        let buena = format!("file://{}", dir.to_str().unwrap());
        let mala = "file:///no/existe/nada".to_string();
        assert_eq!(resolve_uris(&[mala, buena]), vec![dir]);
    }
}
