//! Montar un disco en la nube con gvfs, sin pedirle la contraseña a nadie.
//!
//! ── Por qué montar y no hablar WebDAV desde acá ─────────────────────────────
//!
//! Este gestor trabaja sobre rutas: leer un directorio, previsualizar, buscar,
//! comprimir, arrastrar. Hablar WebDAV desde adentro habría querido decir un
//! sistema de archivos virtual atravesando todo eso. Montado, la ruta que sale
//! es una ruta de verdad y el resto del programa funciona sin enterarse.
//!
//! ── Por qué la biblioteca y no `gio mount` ──────────────────────────────────
//!
//! Porque el comando **no acepta una contraseña**: la pregunta por terminal.
//! Comprobado. La credencial la tenemos —sale del servicio de cuentas— y hacer
//! que la persona la escriba otra vez sería tirar a la basura todo el flujo de
//! conectar la cuenta.
//!
//! Con la biblioteca se le pasa una `MountOperation` que contesta la pregunta
//! sola. Y con `PasswordSave::Never`, para que gvfs no guarde una copia en otro
//! llavero: la credencial ya vive en un único lugar, que es el servicio de
//! cuentas, y duplicarla es multiplicar de dónde puede filtrarse.
//!
//! ── El hilo ─────────────────────────────────────────────────────────────────
//!
//! Todo esto tiene que correr en el hilo del bucle principal de GTK. Un comando
//! de Tauri llega en un hilo de tokio, así que el trabajo se agenda en el
//! principal y el resultado vuelve por un canal.

use std::sync::mpsc;

use gio::glib;
use gio::prelude::*;

use crate::cloud_accounts::{CloudMountError, Credential};

/// Cuánto se espera a que el montaje termine.
///
/// Un servidor que no contesta no puede dejar la ventana esperando para
/// siempre. Un minuto es de sobra para un montaje que anda y corto para uno que
/// no va a andar.
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Monta la cuenta y devuelve la ruta local donde quedó.
///
/// Si ya estaba montada no la vuelve a montar: devuelve la ruta que tiene.
///
/// Una cuenta cuyos archivos todavía no están disponibles no llega a gvfs: la
/// credencial se corta antes de pedir el token, con el motivo.
///
/// Si falla contesta un código y no un texto (ver [`CloudMountError`]): la
/// ventana es la que sabe en qué idioma decirlo.
#[tauri::command]
pub async fn mount_cloud_drive(
    app: tauri::AppHandle,
    account_id: String,
) -> Result<String, CloudMountError> {
    let credential = crate::cloud_accounts::credential_of(&account_id).await?;

    // Si ya está montado no hay nada que hacer, y preguntarlo primero evita un
    // diálogo de gvfs por algo que ya funciona.
    if let Some(path) = path_of(&app, &credential.uri).await? {
        return Ok(path);
    }

    mount(&app, credential.clone()).await?;

    path_of(&app, &credential.uri).await?.ok_or_else(|| {
        // Pasa si gvfsd-fuse no está corriendo: el montaje existe para las
        // aplicaciones que hablan gio, pero no hay ninguna ruta que este
        // gestor pueda abrir.
        CloudMountError::failed(
            "se montó, pero el sistema no expuso una ruta para abrirlo. \
             ¿Está gvfs instalado por completo?",
        )
    })
}

/// La ruta local de una dirección de gvfs, si está montada **y sirve**.
///
/// `g_file_get_path` sobre un URI de gvfs devuelve la ruta que anotó el montaje,
/// y `None` si no hay ninguno. Calcularla a mano —el nombre que arma gvfs con el
/// host y el prefijo— sería atarse a un detalle interno que puede cambiar entre
/// versiones.
///
/// Pero lo que devuelve es lo **anotado**, no lo que hay: no comprueba que
/// `gvfsd-fuse` esté sirviendo esa ruta ahora. Un montaje que quedó de una
/// sesión anterior, o de antes de que fuse se cayera, da una ruta que existe en
/// los metadatos y no en el disco — y el gestor abriría una pestaña vacía sin
/// decir por qué. Así que se comprueba antes de darla por buena.
async fn path_of(app: &tauri::AppHandle, uri: &str) -> Result<Option<String>, CloudMountError> {
    let uri = uri.to_string();
    on_main_thread(app, move |done| {
        let file = gio::File::for_uri(&uri);
        let path = file
            .path()
            .filter(|path| path.is_dir())
            .map(|p| p.to_string_lossy().into_owned());
        let _ = done.send(Ok(path));
    })
    .await
}

/// Hace el montaje, contestando la pregunta de la contraseña.
async fn mount(app: &tauri::AppHandle, credential: Credential) -> Result<(), CloudMountError> {
    // Un cancelador de verdad y no `Cancellable::NONE`.
    //
    // Sin él, cuando se cumple el tope de espera la operación **sigue corriendo**
    // en el bucle principal: nadie la para, y queda un montaje a medias
    // intentando contra un servidor que no contesta. Con esto, agotarse el
    // tiempo también la cancela.
    let cancellable = gio::Cancellable::new();
    let for_timeout = cancellable.clone();

    let result = on_main_thread(app, move |done| {
        let file = gio::File::for_uri(&credential.uri);
        let operation = gio::MountOperation::new();
        let cancellable = cancellable.clone();

        let username = credential.username.clone();
        let secret = credential.secret.clone();
        // Una sola vez.
        //
        // gvfs vuelve a preguntar cuando el servidor rechaza lo que se le dio, y
        // contestar lo mismo otra vez es un bucle: el rechazo de verdad no
        // llegaría nunca y lo que vería la persona sería el tope de tiempo, que
        // no dice nada sobre su contraseña. A la segunda se corta.
        let already_answered = std::cell::Cell::new(false);
        operation.connect_ask_password(
            move |operation, _message, _previous_username, _domain, flags| {
                if already_answered.replace(true) {
                    operation.reply(gio::MountOperationResult::Aborted);
                    return;
                }

                // Sólo lo que pidió. Poner una contraseña donde no se pidió ninguna
                // —un montaje anónimo, por ejemplo— es mandarla sin motivo.
                if flags.contains(gio::AskPasswordFlags::NEED_USERNAME) {
                    operation.set_username(Some(&username));
                }
                if flags.contains(gio::AskPasswordFlags::NEED_PASSWORD) {
                    operation.set_password(Some(&secret));
                }
                // Que gvfs **no** la guarde. La credencial ya vive en el servicio de
                // cuentas; una copia en otro llavero es otro lugar del que puede
                // filtrarse y otro que hay que acordarse de limpiar al borrar la
                // cuenta.
                if flags.contains(gio::AskPasswordFlags::SAVING_SUPPORTED) {
                    operation.set_password_save(gio::PasswordSave::Never);
                }
                operation.reply(gio::MountOperationResult::Handled);
            },
        );

        // gvfs puede querer preguntar otra cosa —un certificado que no
        // reconoce, por ejemplo— y esa señal no está enlazada en gio 0.18: el
        // binding la deja fuera por tipos que no sabe traducir. Sin nadie que
        // conteste, la operación se quedaría esperando.
        //
        // De eso se ocupa el tope de tiempo de más abajo: la ventana no queda
        // colgada y el mensaje dice que el montaje no terminó. No es tan bueno
        // como poder explicar qué preguntó, pero es correcto.

        file.mount_enclosing_volume(
            gio::MountMountFlags::NONE,
            Some(&operation),
            Some(&cancellable),
            move |result| {
                let answer = match result {
                    Ok(()) => Ok(()),
                    // Que ya estuviera montado no es un fallo: es el resultado
                    // que se buscaba. Pasa cuando otra aplicación lo montó
                    // antes.
                    Err(e) if e.matches(gio::IOErrorEnum::AlreadyMounted) => Ok(()),
                    Err(e) => Err(translate_error(&e)),
                };
                let _ = done.send(answer);
            },
        );
    })
    .await;

    // Si se agotó la espera, cancelar: la operación sigue viva en el bucle
    // principal hasta que alguien la pare.
    if result.is_err() {
        for_timeout.cancel();
    }
    result
}

/// Dice qué pasó en términos de lo que la persona puede hacer.
///
/// Un rechazo de credenciales es `needsReconnect`: la contraseña no se escribe
/// acá, y reconectar la cuenta es lo único que la arregla. El resto es
/// `failed`, con un detalle que diga algo más que el código de gio.
fn translate_error(error: &glib::Error) -> CloudMountError {
    if error.matches(gio::IOErrorEnum::PermissionDenied) {
        return CloudMountError::needs_reconnect(format!(
            "el servidor rechazó el usuario o la contraseña: {}",
            error.message()
        ));
    }
    if error.matches(gio::IOErrorEnum::NotSupported) {
        return CloudMountError::failed(
            "este equipo no sabe montar archivos en la nube. \
             Falta el paquete gvfs-dnssd, que trae el soporte de WebDAV",
        );
    }
    if error.matches(gio::IOErrorEnum::HostNotFound) || error.matches(gio::IOErrorEnum::TimedOut) {
        return CloudMountError::failed(format!(
            "no se pudo llegar al servidor: {}",
            error.message()
        ));
    }
    CloudMountError::failed(error.message())
}

/// Corre algo en el hilo del bucle principal y espera su respuesta.
///
/// Lo que se agenda recibe el extremo por el que contestar: las operaciones de
/// gio son asíncronas y terminan más tarde, en el propio bucle, así que la
/// respuesta no puede ser el valor de retorno del cierre.
async fn on_main_thread<T, F>(app: &tauri::AppHandle, work: F) -> Result<T, CloudMountError>
where
    T: Send + 'static,
    F: FnOnce(mpsc::Sender<Result<T, CloudMountError>>) + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();

    app.run_on_main_thread(move || work(sender))
        .map_err(|e| CloudMountError::failed(format!("no se pudo agendar el trabajo: {e}")))?;

    // En un hilo aparte: `recv_timeout` bloquea, y bloquear el hilo de tokio
    // que atiende el comando frenaría todo lo demás.
    tokio::task::spawn_blocking(move || {
        receiver.recv_timeout(TIMEOUT).map_err(|_| {
            CloudMountError::failed(format!(
                "el montaje no terminó en {} segundos",
                TIMEOUT.as_secs()
            ))
        })?
    })
    .await
    .map_err(|e| CloudMountError::failed(format!("se perdió la espera del montaje: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La espera existe para que un servidor que no contesta no deje la ventana
    /// colgada. Sin tope, abrir un disco de un servidor apagado se ve igual que
    /// un programa trabado.
    #[test]
    fn el_montaje_tiene_tope() {
        assert!(TIMEOUT <= std::time::Duration::from_secs(120));
        assert!(TIMEOUT >= std::time::Duration::from_secs(30));
    }

    /// Los mensajes tienen que decir qué hacer, no qué código dio gio.
    ///
    /// El de credenciales es el que más importa: manda a reconectar la cuenta,
    /// que es lo único que la arregla — la contraseña no se escribe acá.
    #[test]
    fn los_errores_dicen_que_hacer() {
        // Un rechazo de credenciales manda a reconectar: la ventana lo dice
        // con `cloudNeedsReconnect`, que nombra Configuración.
        let denied = glib::Error::new(gio::IOErrorEnum::PermissionDenied, "denied");
        let error = translate_error(&denied);
        assert_eq!(error.code, CloudMountError::NEEDS_RECONNECT, "{error:?}");
        assert!(error.detail.contains("denied"), "{error:?}");

        let unsupported = glib::Error::new(gio::IOErrorEnum::NotSupported, "nope");
        let error = translate_error(&unsupported);
        assert_eq!(error.code, CloudMountError::FAILED);
        // Nombra el paquete: es un fallo de instalación y la persona —o quien
        // administre— puede resolverlo.
        assert!(error.detail.contains("gvfs-dnssd"), "{error:?}");

        let unreachable = glib::Error::new(gio::IOErrorEnum::HostNotFound, "nube.ejemplo.com");
        let error = translate_error(&unreachable);
        assert_eq!(error.code, CloudMountError::FAILED);
        assert!(error.detail.contains("nube.ejemplo.com"), "{error:?}");
    }

    /// Un error que no está previsto no se traga: se muestra lo que dijo gio,
    /// que es más útil que un «no se pudo montar» sin detalle.
    #[test]
    fn un_error_desconocido_muestra_lo_que_dijo_gio() {
        let odd = glib::Error::new(gio::IOErrorEnum::InvalidData, "algo muy específico");
        assert_eq!(
            translate_error(&odd),
            CloudMountError::failed("algo muy específico")
        );
    }
}
