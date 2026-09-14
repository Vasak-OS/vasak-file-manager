//! Montar una unidad, incluso cuando hace falta pedir algo.
//!
//! ── Qué estaba roto ─────────────────────────────────────────────────────────
//!
//! Montar era `udisksctl mount -b`, con el error descartado: el `if let Ok(…)`
//! no tenía rama de fallo, así que «no autorizado» y «esto no es un sistema de
//! archivos montable» terminaban los dos en el mismo texto —«instalá udisks2»—
//! que casi nunca era la causa. Del otro lado la ventana lo mandaba a la consola
//! y no mostraba nada. Hacer clic en una unidad que no se podía montar no hacía
//! absolutamente nada visible.
//!
//! Y una partición cifrada no se montaba nunca: antes hay que desbloquearla con
//! su frase de paso, y no había dónde pedirla.
//!
//! ── Por qué el agente y no udisks2 directo ──────────────────────────────────
//!
//! Porque la frase de paso no tiene que pasar por acá. `vasak-polkit-agent` es
//! el lugar del escritorio donde se escriben las contraseñas: él muestra el
//! diálogo, él llama a `Encrypted.Unlock`, y lo que vuelve es el punto de
//! montaje. Este proceso nunca ve la frase.
//!
//! El agente monta también lo que no está cifrado, así que este módulo tiene un
//! solo camino en vez de dos. Cuando hace falta autorización de polkit —una
//! partición interna que no está en `fstab`— el diálogo aparece por el camino de
//! siempre, porque el que pide es `udisks2` y quien contesta es el mismo agente.
//!
//! Queda el respaldo por `udisksctl` para un sistema donde el agente no esté
//! corriendo: ahí no hay dónde pedir nada, pero un pendrive sin cifrar se monta
//! igual.

use std::collections::HashMap;

use serde::Serialize;
use zvariant::{OwnedObjectPath, OwnedValue, Value};

const DESTINO_DEL_AGENTE: &str = "ar.net.vasak.os.DeviceUnlock";
const RUTA_DEL_AGENTE: &str = "/ar/net/vasak/os/DeviceUnlock";

const UDISKS: &str = "org.freedesktop.UDisks2";
const UDISKS_GESTOR: &str = "/org/freedesktop/UDisks2/Manager";

/// Por qué no se pudo montar, en términos que la ventana pueda traducir.
///
/// El código y no el texto: los mensajes de `udisks2` vienen en inglés y no son
/// para mostrar. El detalle va igual, para el registro y para quien quiera
/// mirarlo.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FalloDeMontaje {
    pub codigo: String,
    pub detalle: String,
}

impl FalloDeMontaje {
    fn nuevo(codigo: &str, detalle: impl Into<String>) -> Self {
        Self {
            codigo: codigo.to_string(),
            detalle: detalle.into(),
        }
    }
}

/// Los códigos que entiende la ventana. Cada uno tiene su texto traducido, y
/// `cancelled` además no se muestra: cerrar el diálogo de la contraseña es una
/// respuesta, no un fallo, y un cartel de error ahí le diría a la persona que
/// algo salió mal cuando hizo exactamente lo que quería. Quién se muestra y
/// quién no lo decide la ventana (`aviso-de-montaje.ts`).
pub const CANCELADO: &str = "cancelled";
pub const NO_AUTORIZADO: &str = "notAuthorized";
pub const FRASE_INCORRECTA: &str = "wrongPassphrase";
pub const FALLO: &str = "failed";

/// Qué significa cada error que puede volver del agente.
///
/// `ServiceUnknown` y `NameHasNoOwner` son el caso especial: no es que el
/// montaje haya fallado, es que no hay agente. Se distinguen para poder caer al
/// respaldo en vez de mostrar un error.
pub fn clasificar(nombre_del_error: &str, detalle: &str) -> Result<FalloDeMontaje, SinAgente> {
    let corto = nombre_del_error
        .rsplit('.')
        .next()
        .unwrap_or(nombre_del_error);

    match corto {
        "ServiceUnknown" | "NameHasNoOwner" | "NoReply" => Err(SinAgente),
        "Cancelado" => Ok(FalloDeMontaje::nuevo(CANCELADO, detalle)),
        "NoAutorizado" => Ok(FalloDeMontaje::nuevo(NO_AUTORIZADO, detalle)),
        "FraseIncorrecta" => Ok(FalloDeMontaje::nuevo(FRASE_INCORRECTA, detalle)),
        _ => Ok(FalloDeMontaje::nuevo(
            FALLO,
            if detalle.trim().is_empty() {
                nombre_del_error.to_string()
            } else {
                detalle.to_string()
            },
        )),
    }
}

/// No hay agente al que pedirle esto.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SinAgente;

/// Monta la unidad y devuelve dónde quedó.
pub async fn montar(dispositivo: &str) -> Result<String, FalloDeMontaje> {
    match por_el_agente(dispositivo).await {
        Ok(punto) => Ok(punto),
        Err(Ok(fallo)) => Err(fallo),
        // Sin agente no hay dónde pedir una frase ni una contraseña, pero lo que
        // no necesita ninguna de las dos se puede montar igual.
        Err(Err(SinAgente)) => por_udisksctl(dispositivo),
    }
}

/// El camino normal: se lo pide al agente.
///
/// El error de afuera distingue «falló el montaje» de «no hay agente», que es lo
/// único que quien llama necesita separar.
async fn por_el_agente(dispositivo: &str) -> Result<String, Result<FalloDeMontaje, SinAgente>> {
    let conexion = zbus::Connection::session()
        .await
        .map_err(|_| Err(SinAgente))?;

    let respuesta = conexion
        .call_method(
            Some(DESTINO_DEL_AGENTE),
            RUTA_DEL_AGENTE,
            Some(DESTINO_DEL_AGENTE),
            "UnlockAndMount",
            &(dispositivo,),
        )
        .await
        .map_err(|error| match &error {
            zbus::Error::MethodError(nombre, detalle, _) => {
                clasificar(nombre.as_str(), detalle.as_deref().unwrap_or_default())
            }
            // Que el nombre no esté en el bus llega como un error de conexión y
            // no como uno de método.
            _ => Err(SinAgente),
        })?;

    let cuerpo = respuesta.body();
    cuerpo.deserialize::<String>().map_err(|error| {
        Ok(FalloDeMontaje::nuevo(
            FALLO,
            format!("el agente contestó algo inesperado: {error}"),
        ))
    })
}

/// El respaldo, para un sistema sin agente.
///
/// Sigue siendo `udisksctl`, pero ahora con el error a la vista: si la causa era
/// que hacía falta autorización, al menos se ve.
fn por_udisksctl(dispositivo: &str) -> Result<String, FalloDeMontaje> {
    let salida = std::process::Command::new("udisksctl")
        .args(["mount", "-b", dispositivo])
        .output()
        .map_err(|error| {
            FalloDeMontaje::nuevo(FALLO, format!("no se pudo ejecutar udisksctl: {error}"))
        })?;

    if !salida.status.success() {
        let detalle = String::from_utf8_lossy(&salida.stderr).trim().to_string();
        return Err(FalloDeMontaje::nuevo(
            FALLO,
            if detalle.is_empty() {
                format!("udisksctl no pudo montar {dispositivo}")
            } else {
                detalle
            },
        ));
    }

    Ok(punto_de_montaje_de(&String::from_utf8_lossy(
        &salida.stdout,
    )))
}

/// `udisksctl` contesta «Mounted /dev/sdb1 at /run/media/pato/Datos.»
pub fn punto_de_montaje_de(salida: &str) -> String {
    salida
        .split(" at ")
        .nth(1)
        .map(|resto| resto.trim().trim_end_matches('.').to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cerrar_el_dialogo_no_es_un_error_que_haya_que_mostrar() {
        let fallo =
            clasificar("ar.net.vasak.os.DeviceUnlock.Cancelado", "se cerró").expect("hay agente");

        assert_eq!(fallo.codigo, CANCELADO);
    }

    #[test]
    fn los_demas_errores_si_se_muestran() {
        for (nombre, codigo) in [
            ("ar.net.vasak.os.DeviceUnlock.NoAutorizado", NO_AUTORIZADO),
            (
                "ar.net.vasak.os.DeviceUnlock.FraseIncorrecta",
                FRASE_INCORRECTA,
            ),
            ("ar.net.vasak.os.DeviceUnlock.Fallo", FALLO),
        ] {
            let fallo = clasificar(nombre, "detalle").expect("hay agente");

            assert_eq!(fallo.codigo, codigo);
            assert_ne!(fallo.codigo, CANCELADO);
        }
    }

    #[test]
    fn que_no_haya_agente_no_es_un_fallo_de_montaje() {
        // Es la diferencia entre mostrar un error y probar por el otro camino.
        assert_eq!(
            clasificar("org.freedesktop.DBus.Error.ServiceUnknown", "no such name"),
            Err(SinAgente)
        );
        assert_eq!(
            clasificar("org.freedesktop.DBus.Error.NameHasNoOwner", ""),
            Err(SinAgente)
        );
    }

    #[test]
    fn un_error_que_no_se_conoce_se_muestra_igual() {
        // Antes todo terminaba en «instalá udisks2»; ahora lo que no se reconoce
        // llega con su detalle, que es más útil que una causa inventada.
        let fallo = clasificar("org.freedesktop.UDisks2.Error.DeviceBusy", "target is busy")
            .expect("hay agente");

        assert_eq!(fallo.codigo, FALLO);
        assert_eq!(fallo.detalle, "target is busy");
    }

    #[test]
    fn un_error_sin_detalle_se_queda_con_el_nombre() {
        let fallo =
            clasificar("org.freedesktop.UDisks2.Error.DeviceBusy", "  ").expect("hay agente");

        assert_eq!(fallo.detalle, "org.freedesktop.UDisks2.Error.DeviceBusy");
    }

    #[test]
    fn se_saca_el_punto_de_montaje_de_lo_que_dice_udisksctl() {
        assert_eq!(
            punto_de_montaje_de("Mounted /dev/sdb1 at /run/media/pato/Datos.\n"),
            "/run/media/pato/Datos"
        );
    }

    #[test]
    fn una_salida_que_no_tiene_esa_forma_no_inventa_una_ruta() {
        // Devolver algo a medias haría que la ventana navegue a una ruta que no
        // existe; vacío es lo que ya sabe manejar.
        assert_eq!(punto_de_montaje_de("Mounted /dev/sdb1"), "");
        assert_eq!(punto_de_montaje_de(""), "");
    }
}

// ---------------------------------------------------------------------------
// Cerrar lo que se abrió
// ---------------------------------------------------------------------------

/// Vuelve a cerrar el volumen cifrado que hay debajo de una unidad desmontada.
///
/// Sin esto, «expulsar» un disco cifrado lo desmonta y lo deja **abierto**: el
/// volumen en claro sigue existiendo en `/dev/mapper`, así que basta volver a
/// montarlo —o que lo monte cualquier otra cosa— para leerlo sin la frase. La
/// persona que expulsó un disco cifrado espera lo contrario, y es lo único que
/// hace que valga la pena haberlo cifrado.
///
/// Falla en silencio: el desmontaje ya salió bien y no hay nada que la ventana
/// pueda hacer con este error. Si el volumen no era cifrado, no hay nada que
/// cerrar y tampoco es un fallo.
pub async fn cerrar_volumen_cifrado(dispositivo: &str) {
    let Ok(conexion) = zbus::Connection::system().await else {
        return;
    };

    let Some(objeto) = resolver(&conexion, dispositivo).await else {
        return;
    };

    // El objeto del volumen **cifrado** que respalda a este en claro. `udisks2`
    // devuelve `/` cuando no hay ninguno, que es su manera de decir «esto no
    // estaba cifrado».
    let Some(cifrado) = propiedad(
        &conexion,
        &objeto,
        "org.freedesktop.UDisks2.Block",
        "CryptoBackingDevice",
    )
    .await
    .and_then(|valor| OwnedObjectPath::try_from(valor).ok())
    .filter(|ruta| ruta.as_str() != "/") else {
        return;
    };

    let opciones: HashMap<&str, Value<'_>> = HashMap::new();
    if let Err(error) = conexion
        .call_method(
            Some(UDISKS),
            &cifrado,
            Some("org.freedesktop.UDisks2.Encrypted"),
            "Lock",
            &(opciones,),
        )
        .await
    {
        log::warn!("no se pudo cerrar el volumen cifrado de {dispositivo}: {error}");
    }
}

/// El objeto de `udisks2` para una ruta de dispositivo.
async fn resolver(conexion: &zbus::Connection, dispositivo: &str) -> Option<OwnedObjectPath> {
    if !dispositivo.starts_with("/dev/") {
        return None;
    }

    let especificacion: HashMap<&str, Value<'_>> =
        HashMap::from([("path", Value::from(dispositivo))]);
    let opciones: HashMap<&str, Value<'_>> = HashMap::new();

    let respuesta = conexion
        .call_method(
            Some(UDISKS),
            UDISKS_GESTOR,
            Some("org.freedesktop.UDisks2.Manager"),
            "ResolveDevice",
            &(especificacion, opciones),
        )
        .await
        .ok()?;

    let cuerpo = respuesta.body();
    cuerpo
        .deserialize::<Vec<OwnedObjectPath>>()
        .ok()?
        .into_iter()
        .next()
}

async fn propiedad(
    conexion: &zbus::Connection,
    objeto: &OwnedObjectPath,
    interfaz: &str,
    nombre: &str,
) -> Option<OwnedValue> {
    let respuesta = conexion
        .call_method(
            Some(UDISKS),
            objeto,
            Some("org.freedesktop.DBus.Properties"),
            "Get",
            &(interfaz, nombre),
        )
        .await
        .ok()?;

    let cuerpo = respuesta.body();
    cuerpo.deserialize::<OwnedValue>().ok()
}
