use log::info;
use std::cell::Cell;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Lo que dice `run_with_pkexec` cuando la persona descartó el diálogo o la
/// autorización no se pudo obtener. Reconocerlo (`is_auth_refused`) es lo que
/// permite no volver a pedir la contraseña en la misma operación.
pub const AUTH_REFUSED: &str = "Authentication cancelled or polkit denied.";

#[cfg(not(test))]
fn pkexec_program() -> PathBuf {
    PathBuf::from("/usr/bin/pkexec")
}

/// En las pruebas, por omisión un programa que falla sin hacer nada: correr cada
/// operación de verdad sin que aparezca un diálogo de contraseña ni se toque el
/// disco. Una prueba puede poner el suyo (por hilo: corren en paralelo) para
/// contar cuántas veces se pidió elevar.
#[cfg(test)]
fn pkexec_program() -> PathBuf {
    testing::PKEXEC
        .with(|program| program.borrow().clone())
        .unwrap_or_else(|| PathBuf::from("/usr/bin/false"))
}

fn pkexec_available() -> bool {
    pkexec_program().exists()
}

/// Qué es el resultado de `pkexec`: 126 es que se descartó el diálogo y 127 que la
/// autorización no se pudo obtener (man pkexec); el resto es lo que dijo el
/// programa elevado.
fn outcome(exit_code: Option<i32>, stderr: &str) -> Result<(), String> {
    match exit_code {
        Some(0) => Ok(()),
        Some(126) | Some(127) => Err(AUTH_REFUSED.into()),
        _ => Err(stderr.trim().to_string()),
    }
}

fn run_with_pkexec(args: &[&str]) -> Result<(), String> {
    if !pkexec_available() {
        return Err("pkexec not available. Install polkit.".into());
    }
    info!("Elevating privileges: pkexec {}", args.join(" "));
    let output = Command::new(pkexec_program())
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute pkexec: {e}"))?;
    outcome(
        output.status.code(),
        &String::from_utf8_lossy(&output.stderr),
    )
}

/// Si el error es que la persona no autorizó (descartó el diálogo o falló la
/// contraseña), no que el programa elevado falló.
pub fn is_auth_refused(error: &str) -> bool {
    error == AUTH_REFUSED
}

/// La autorización de **una** operación: lo que pide contraseña lo hace una vez, y
/// si la persona la rechaza no se vuelve a pedir.
///
/// Sin esto, una operación sobre varias cosas pide la contraseña por cada una, y
/// rechazarla en la primera no la detiene: la siguiente la vuelve a pedir.
#[derive(Default)]
pub struct Elevation {
    refused: Cell<bool>,
}

impl Elevation {
    pub fn new() -> Self {
        Self::default()
    }

    /// Si ya se rechazó en esta operación.
    pub fn refused(&self) -> bool {
        self.refused.get()
    }

    /// Da por rechazada la autorización de esta operación (la rechazó una
    /// llamada que no pasó por `attempt`).
    pub fn refuse(&self) {
        self.refused.set(true);
    }

    /// Corre `ask` (una llamada a pkexec) salvo que ya se haya rechazado: en ese
    /// caso devuelve el mismo rechazo sin mostrar nada.
    pub fn attempt(&self, ask: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        if self.refused.get() {
            return Err(AUTH_REFUSED.into());
        }
        let result = ask();
        if result.as_ref().is_err_and(|error| is_auth_refused(error)) {
            self.refused.set(true);
        }
        result
    }
}

pub fn copy_with_pkexec(src: &Path, dest: &Path) -> Result<(), String> {
    run_with_pkexec(&[
        "cp",
        "-r",
        "--",
        &src.to_string_lossy(),
        &dest.to_string_lossy(),
    ])
}

/// El **contenido** de una carpeta sobre `dest`, exista ya o no. `cp -r src dest`
/// con `dest` existente copia *adentro* (`dest/src`), y una copia sin privilegios
/// que quedó a medias lo deja existiendo.
pub fn copy_dir_contents_with_pkexec(src: &Path, dest: &Path) -> Result<(), String> {
    run_with_pkexec(&[
        "cp",
        "-r",
        "-T",
        "--",
        &src.to_string_lossy(),
        &dest.to_string_lossy(),
    ])
}

/// Varias cosas **adentro** de `dest_dir`, con su mismo nombre, en una sola
/// elevación: una contraseña por operación y no una por archivo.
pub fn copy_into_with_pkexec(sources: &[&Path], dest_dir: &Path) -> Result<(), String> {
    let dest_dir = dest_dir.to_string_lossy();
    let sources: Vec<_> = sources.iter().map(|s| s.to_string_lossy()).collect();
    let mut args = vec!["cp", "-r", "-t", dest_dir.as_ref(), "--"];
    args.extend(sources.iter().map(|s| s.as_ref()));
    run_with_pkexec(&args)
}

pub fn move_with_pkexec(src: &Path, dest: &Path) -> Result<(), String> {
    run_with_pkexec(&["mv", "--", &src.to_string_lossy(), &dest.to_string_lossy()])
}

pub fn remove_with_pkexec(path: &Path) -> Result<(), String> {
    run_with_pkexec(&["rm", "-rf", "--", &path.to_string_lossy()])
}

pub fn create_dir_with_pkexec(path: &Path) -> Result<(), String> {
    run_with_pkexec(&["mkdir", "-p", "--", &path.to_string_lossy()])
}

pub fn create_file_with_pkexec(path: &Path) -> Result<(), String> {
    run_with_pkexec(&["touch", "--", &path.to_string_lossy()])
}

pub fn rename_with_pkexec(src: &Path, dest: &Path) -> Result<(), String> {
    run_with_pkexec(&["mv", "--", &src.to_string_lossy(), &dest.to_string_lossy()])
}

/// Por el código y no sólo por el texto: GTK pone el proceso en el idioma de la
/// persona, y en castellano glibc dice «Permiso denegado», que no estaba en la
/// lista —no se pedía la contraseña nunca—. Rust agrega `(os error N)` en
/// cualquier idioma: 13 es `EACCES` y 1 es `EPERM`.
pub fn is_permission_denied(error: &str) -> bool {
    error.contains("(os error 13)")
        || error.contains("(os error 1)")
        || error.contains("Permiso denegado")
        || error.contains("Permission denied")
        || error.contains("Acceso denegado")
        || error.contains("Operation not permitted")
        || error.contains("Operación no permitida")
}

/// El `pkexec` falso de las pruebas de elevación (ver `pkexec_program`).
#[cfg(test)]
pub(crate) mod testing {
    use std::cell::RefCell;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};

    thread_local! {
        pub(super) static PKEXEC: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
    }

    /// Un directorio de prueba propio, vacío.
    pub(crate) fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vasak-fm-{name}-{}", std::process::id()));
        cleanup(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Borra un directorio de prueba aunque haya quedado sin permiso de escritura.
    pub(crate) fn cleanup(dir: &Path) {
        if dir.exists() {
            let _ = std::process::Command::new("chmod")
                .args(["-R", "u+rwx"])
                .arg(dir)
                .status();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// Quita el permiso de escritura: como un destino de root para una persona común.
    pub(crate) fn make_read_only(dir: &Path) {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o555)).unwrap();
    }

    /// Si la prueba corre como root el destino «de root» no niega nada.
    pub(crate) fn running_as_root() -> bool {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata("/proc/self")
            .map(|m| m.uid() == 0)
            .unwrap_or(false)
    }

    fn install(dir: &Path, script: &str) -> PathBuf {
        let program = dir.join("pkexec-falso");
        std::fs::write(&program, script).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        PKEXEC.with(|p| *p.borrow_mut() = Some(program));
        dir.join("invocaciones.log")
    }

    /// Un `pkexec` que **autoriza**: anota cada llamada y corre el comando con
    /// `root` escribible sólo mientras dura, como si lo hiciera root.
    pub(crate) fn install_authorizing(dir: &Path, root: &Path) -> PathBuf {
        let log = dir.join("invocaciones.log");
        install(
            dir,
            &format!(
                "#!/bin/sh\necho \"$*\" >> '{}'\nchmod -R u+w '{}'\n\"$@\"\nrc=$?\nchmod -R u-w '{}'\nexit $rc\n",
                log.display(),
                root.display(),
                root.display()
            ),
        )
    }

    /// Un `pkexec` que **no autoriza**: anota la llamada y sale con `code`
    /// (126: se descartó el diálogo; 127: no se pudo autorizar).
    pub(crate) fn install_refusing(dir: &Path, code: i32) -> PathBuf {
        let log = dir.join("invocaciones.log");
        install(
            dir,
            &format!(
                "#!/bin/sh\necho \"$*\" >> '{}'\nexit {code}\n",
                log.display()
            ),
        )
    }

    /// Las llamadas a pkexec que hubo, una por línea (los argumentos).
    pub(crate) fn invocations(log: &Path) -> Vec<String> {
        std::fs::read_to_string(log)
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cada_operacion_elevada_pasa_por_pkexec_y_devuelve_su_fallo() {
        let a = Path::new("/no/existe/a");
        let b = Path::new("/no/existe/b");
        assert!(copy_with_pkexec(a, b).is_err());
        assert!(move_with_pkexec(a, b).is_err());
        assert!(remove_with_pkexec(a).is_err());
        assert!(create_dir_with_pkexec(a).is_err());
        assert!(create_file_with_pkexec(a).is_err());
        assert!(rename_with_pkexec(a, b).is_err());
        assert!(copy_dir_contents_with_pkexec(a, b).is_err());
        assert!(copy_into_with_pkexec(&[a, b], Path::new("/no/existe/c")).is_err());
    }

    #[test]
    fn el_mensaje_en_castellano_de_permiso_denegado_se_detecta() {
        assert!(is_permission_denied("Permiso denegado (os error 13)"));
        assert!(is_permission_denied("Permiso denegado"));
    }

    #[test]
    fn el_codigo_13_se_detecta_aunque_el_texto_este_en_otro_idioma() {
        assert!(is_permission_denied("Zugriff verweigert (os error 13)"));
    }

    #[test]
    fn el_error_de_operacion_no_permitida_por_codigo_se_detecta() {
        let error = std::io::Error::from_raw_os_error(1).to_string();
        assert!(error.contains("(os error 1)"));
        assert!(is_permission_denied(&error));
        assert!(is_permission_denied("Operação não permitida (os error 1)"));
    }

    #[test]
    fn el_error_de_permiso_del_sistema_se_detecta_sea_cual_sea_el_idioma() {
        let error = std::io::Error::from_raw_os_error(13).to_string();
        assert!(is_permission_denied(&error));
    }

    #[test]
    fn los_errores_ajenos_a_los_permisos_no_piden_contrasena() {
        assert!(!is_permission_denied(
            "No such file or directory (os error 2)"
        ));
        assert!(!is_permission_denied(
            "No existe el archivo o el directorio (os error 2)"
        ));
        assert!(!is_permission_denied(
            "Cannot allocate memory (os error 12)"
        ));
        assert!(!is_permission_denied("No child processes (os error 10)"));
        assert!(!is_permission_denied("File exists (os error 17)"));
    }

    #[test]
    fn el_resultado_de_pkexec_distingue_no_autorizar_de_fallar_el_programa() {
        assert_eq!(outcome(Some(0), ""), Ok(()));
        // 126: se descartó el diálogo. 127: no se pudo autorizar (man pkexec). Antes
        // sólo se conocía el 127, y el 126 salía como un error sin texto.
        assert_eq!(outcome(Some(126), ""), Err(AUTH_REFUSED.to_string()));
        assert_eq!(outcome(Some(127), "x"), Err(AUTH_REFUSED.to_string()));
        // El programa elevado que falla dice por qué, y eso no es un rechazo.
        assert_eq!(
            outcome(Some(1), "cp: no hay espacio\n"),
            Err("cp: no hay espacio".to_string())
        );
        assert_eq!(outcome(None, "murió"), Err("murió".to_string()));
    }

    #[test]
    fn solo_el_rechazo_de_la_autorizacion_cuenta_como_rechazo() {
        assert!(is_auth_refused(AUTH_REFUSED));
        assert!(!is_auth_refused("cp: Permission denied"));
        assert!(!is_auth_refused(""));
    }

    #[test]
    fn la_autorizacion_de_una_operacion_no_vuelve_a_pedir_tras_un_rechazo() {
        let elevation = Elevation::new();
        let mut asked = 0;

        let first = elevation.attempt(|| {
            asked += 1;
            Err(AUTH_REFUSED.to_string())
        });
        let second = elevation.attempt(|| {
            asked += 1;
            Ok(())
        });

        assert_eq!(first, Err(AUTH_REFUSED.to_string()));
        // Sin esto cada cosa de la operación volvía a mostrar la contraseña.
        assert_eq!(second, Err(AUTH_REFUSED.to_string()));
        assert_eq!(asked, 1);
        assert!(elevation.refused());
    }

    #[test]
    fn un_fallo_del_programa_elevado_no_corta_las_autorizaciones_siguientes() {
        let elevation = Elevation::new();

        assert!(elevation.attempt(|| Err("cp: sin espacio".into())).is_err());
        assert!(!elevation.refused());
        assert_eq!(elevation.attempt(|| Ok(())), Ok(()));
    }

    #[test]
    fn rechazar_por_fuera_de_attempt_tambien_corta() {
        let elevation = Elevation::new();
        elevation.refuse();
        let mut asked = false;

        let result = elevation.attempt(|| {
            asked = true;
            Ok(())
        });

        assert!(result.is_err() && !asked);
    }

    #[test]
    fn copiar_varias_cosas_adentro_es_una_sola_llamada_con_cada_origen() {
        let dir = testing::scratch("polkit-adentro");
        let log = testing::install_refusing(&dir, 1);

        let _ = copy_into_with_pkexec(
            &[Path::new("/o/a b.txt"), Path::new("/o/carpeta")],
            Path::new("/d"),
        );

        // `-t` antes de `--` y los orígenes después: un nombre que empieza con
        // «-» no se toma por opción.
        assert_eq!(
            testing::invocations(&log),
            vec!["cp -r -t /d -- /o/a b.txt /o/carpeta".to_string()]
        );
        testing::cleanup(&dir);
    }

    #[test]
    fn copiar_el_contenido_de_una_carpeta_usa_t_para_no_anidarla() {
        let dir = testing::scratch("polkit-contenido");
        let log = testing::install_refusing(&dir, 1);

        let _ = copy_dir_contents_with_pkexec(Path::new("/o/c"), Path::new("/d/c"));

        assert_eq!(
            testing::invocations(&log),
            vec!["cp -r -T -- /o/c /d/c".to_string()]
        );
        testing::cleanup(&dir);
    }
}
