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

use crate::cuentas_en_la_nube::Credencial;

/// Cuánto se espera a que el montaje termine.
///
/// Un servidor que no contesta no puede dejar la ventana esperando para
/// siempre. Un minuto es de sobra para un montaje que anda y corto para uno que
/// no va a andar.
const ESPERA: std::time::Duration = std::time::Duration::from_secs(60);

/// Monta la cuenta y devuelve la ruta local donde quedó.
///
/// Si ya estaba montada no la vuelve a montar: devuelve la ruta que tiene.
#[tauri::command]
pub async fn montar_disco_en_la_nube(
    app: tauri::AppHandle,
    account_id: String,
) -> Result<String, String> {
    let credencial = crate::cuentas_en_la_nube::credencial_de(&account_id).await?;

    // Si ya está montado no hay nada que hacer, y preguntarlo primero evita un
    // diálogo de gvfs por algo que ya funciona.
    if let Some(ruta) = ruta_de(&app, &credencial.uri).await? {
        return Ok(ruta);
    }

    montar(&app, credencial.clone()).await?;

    ruta_de(&app, &credencial.uri)
        .await?
        .ok_or_else(|| {
            // Pasa si gvfsd-fuse no está corriendo: el montaje existe para las
            // aplicaciones que hablan gio, pero no hay ninguna ruta que este
            // gestor pueda abrir.
            "se montó, pero el sistema no expuso una ruta para abrirlo. \
             ¿Está gvfs instalado por completo?"
                .to_string()
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
async fn ruta_de(app: &tauri::AppHandle, uri: &str) -> Result<Option<String>, String> {
    let uri = uri.to_string();
    en_el_hilo_principal(app, move |terminado| {
        let archivo = gio::File::for_uri(&uri);
        let ruta = archivo
            .path()
            .filter(|ruta| ruta.is_dir())
            .map(|p| p.to_string_lossy().into_owned());
        let _ = terminado.send(Ok(ruta));
    })
    .await
}

/// Hace el montaje, contestando la pregunta de la contraseña.
async fn montar(app: &tauri::AppHandle, credencial: Credencial) -> Result<(), String> {
    // Un cancelador de verdad y no `Cancellable::NONE`.
    //
    // Sin él, cuando se cumple el tope de espera la operación **sigue corriendo**
    // en el bucle principal: nadie la para, y queda un montaje a medias
    // intentando contra un servidor que no contesta. Con esto, agotarse el
    // tiempo también la cancela.
    let cancelador = gio::Cancellable::new();
    let para_el_tope = cancelador.clone();

    let resultado = en_el_hilo_principal(app, move |terminado| {
        let archivo = gio::File::for_uri(&credencial.uri);
        let operacion = gio::MountOperation::new();
        let cancelador = cancelador.clone();

        let usuario = credencial.usuario.clone();
        let secreto = credencial.secreto.clone();
        // Una sola vez.
        //
        // gvfs vuelve a preguntar cuando el servidor rechaza lo que se le dio, y
        // contestar lo mismo otra vez es un bucle: el rechazo de verdad no
        // llegaría nunca y lo que vería la persona sería el tope de tiempo, que
        // no dice nada sobre su contraseña. A la segunda se corta.
        let ya_contesto = std::cell::Cell::new(false);
        operacion.connect_ask_password(move |operacion, _mensaje, _usuario_previo, _dominio, flags| {
            if ya_contesto.replace(true) {
                operacion.reply(gio::MountOperationResult::Aborted);
                return;
            }

            // Sólo lo que pidió. Poner una contraseña donde no se pidió ninguna
            // —un montaje anónimo, por ejemplo— es mandarla sin motivo.
            if flags.contains(gio::AskPasswordFlags::NEED_USERNAME) {
                operacion.set_username(Some(&usuario));
            }
            if flags.contains(gio::AskPasswordFlags::NEED_PASSWORD) {
                operacion.set_password(Some(&secreto));
            }
            // Que gvfs **no** la guarde. La credencial ya vive en el servicio de
            // cuentas; una copia en otro llavero es otro lugar del que puede
            // filtrarse y otro que hay que acordarse de limpiar al borrar la
            // cuenta.
            if flags.contains(gio::AskPasswordFlags::SAVING_SUPPORTED) {
                operacion.set_password_save(gio::PasswordSave::Never);
            }
            operacion.reply(gio::MountOperationResult::Handled);
        });

        // gvfs puede querer preguntar otra cosa —un certificado que no
        // reconoce, por ejemplo— y esa señal no está enlazada en gio 0.18: el
        // binding la deja fuera por tipos que no sabe traducir. Sin nadie que
        // conteste, la operación se quedaría esperando.
        //
        // De eso se ocupa el tope de tiempo de más abajo: la ventana no queda
        // colgada y el mensaje dice que el montaje no terminó. No es tan bueno
        // como poder explicar qué preguntó, pero es correcto.

        archivo.mount_enclosing_volume(
            gio::MountMountFlags::NONE,
            Some(&operacion),
            Some(&cancelador),
            move |resultado| {
                let respuesta = match resultado {
                    Ok(()) => Ok(()),
                    // Que ya estuviera montado no es un fallo: es el resultado
                    // que se buscaba. Pasa cuando otra aplicación lo montó
                    // antes.
                    Err(e) if e.matches(gio::IOErrorEnum::AlreadyMounted) => Ok(()),
                    Err(e) => Err(traducir(&e)),
                };
                let _ = terminado.send(respuesta);
            },
        );
    })
    .await;

    // Si se agotó la espera, cancelar: la operación sigue viva en el bucle
    // principal hasta que alguien la pare.
    if resultado.is_err() {
        para_el_tope.cancel();
    }
    resultado
}

/// Dice qué pasó en términos de lo que la persona puede hacer.
fn traducir(error: &glib::Error) -> String {
    if error.matches(gio::IOErrorEnum::PermissionDenied) {
        return "el servidor rechazó el usuario o la contraseña. \
                Volvé a conectar la cuenta desde Configuración"
            .into();
    }
    if error.matches(gio::IOErrorEnum::NotSupported) {
        return "este equipo no sabe montar archivos en la nube. \
                Falta el paquete gvfs-dnssd, que trae el soporte de WebDAV"
            .into();
    }
    if error.matches(gio::IOErrorEnum::HostNotFound) || error.matches(gio::IOErrorEnum::TimedOut) {
        return format!("no se pudo llegar al servidor: {}", error.message());
    }
    error.message().to_string()
}

/// Corre algo en el hilo del bucle principal y espera su respuesta.
///
/// Lo que se agenda recibe el extremo por el que contestar: las operaciones de
/// gio son asíncronas y terminan más tarde, en el propio bucle, así que la
/// respuesta no puede ser el valor de retorno del cierre.
async fn en_el_hilo_principal<T, F>(app: &tauri::AppHandle, trabajo: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(mpsc::Sender<Result<T, String>>) + Send + 'static,
{
    let (emisor, receptor) = mpsc::channel();

    app.run_on_main_thread(move || trabajo(emisor))
        .map_err(|e| format!("no se pudo agendar el trabajo: {e}"))?;

    // En un hilo aparte: `recv_timeout` bloquea, y bloquear el hilo de tokio
    // que atiende el comando frenaría todo lo demás.
    tokio::task::spawn_blocking(move || {
        receptor
            .recv_timeout(ESPERA)
            .map_err(|_| format!("el montaje no terminó en {} segundos", ESPERA.as_secs()))?
    })
    .await
    .map_err(|e| format!("se perdió la espera del montaje: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La espera existe para que un servidor que no contesta no deje la ventana
    /// colgada. Sin tope, abrir un disco de un servidor apagado se ve igual que
    /// un programa trabado.
    #[test]
    fn el_montaje_tiene_tope() {
        assert!(ESPERA <= std::time::Duration::from_secs(120));
        assert!(ESPERA >= std::time::Duration::from_secs(30));
    }

    /// Los mensajes tienen que decir qué hacer, no qué código dio gio.
    ///
    /// El de credenciales es el que más importa: manda a reconectar la cuenta,
    /// que es lo único que la arregla — la contraseña no se escribe acá.
    #[test]
    fn los_errores_dicen_que_hacer() {
        let rechazado = glib::Error::new(gio::IOErrorEnum::PermissionDenied, "denied");
        let mensaje = traducir(&rechazado);
        assert!(mensaje.contains("Configuración"), "{mensaje}");

        let sin_soporte = glib::Error::new(gio::IOErrorEnum::NotSupported, "nope");
        let mensaje = traducir(&sin_soporte);
        // Nombra el paquete: es un fallo de instalación y la persona —o quien
        // administre— puede resolverlo.
        assert!(mensaje.contains("gvfs-dnssd"), "{mensaje}");
    }

    /// Un error que no está previsto no se traga: se muestra lo que dijo gio,
    /// que es más útil que un «no se pudo montar» sin detalle.
    #[test]
    fn un_error_desconocido_muestra_lo_que_dijo_gio() {
        let raro = glib::Error::new(gio::IOErrorEnum::InvalidData, "algo muy específico");
        assert_eq!(traducir(&raro), "algo muy específico");
    }
}
