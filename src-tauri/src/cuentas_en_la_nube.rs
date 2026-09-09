//! Los discos en la nube de las cuentas en línea.
//!
//! ── Qué pide este programa, y qué no ────────────────────────────────────────
//!
//! `account.drive` y nada más. No el correo, ni el calendario, ni los contactos:
//! eso es de las aplicaciones que les corresponden. El límite no es sólo una
//! convención — `vasak-permissions` lo tiene declarado para este binario, así
//! que un pedido fuera de ahí se niega sin siquiera preguntarle a la persona.
//!
//! ── Cómo llega a los archivos ───────────────────────────────────────────────
//!
//! Montándolos, y eso es deliberado. Este gestor trabaja sobre rutas: leer un
//! directorio, previsualizar, comprimir, buscar, arrastrar. Hablar WebDAV desde
//! adentro habría querido decir un sistema de archivos virtual atravesando todo
//! eso. Montado con gvfs, la ruta que sale es una ruta de verdad y **el resto
//! del programa funciona sin enterarse**.
//!
//! La credencial no la escribe nadie: sale del servicio de cuentas y se le pasa
//! a gvfs sin pasar por ninguna pantalla.

use serde::{Deserialize, Serialize};

const SERVICE: &str = "ar.net.vasak.os.AccountManager";
const PATH: &str = "/ar/net/vasak/os/AccountManager";
const INTERFACE: &str = "ar.net.vasak.os.AccountManager";

/// La capacidad que este programa puede pedir. La única.
const CAPACIDAD: &str = "drive";

/// El resumen de una cuenta, tal como lo devuelve `ListAccounts`.
#[derive(Debug, Clone, Deserialize)]
struct Resumen {
    id: String,
    display_name: String,
    provider_type: String,
    capabilities: Vec<String>,
    #[serde(default)]
    needs_reauth: bool,
}

/// Un disco en la nube listo para mostrarse en la barra lateral.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DiscoEnLaNube {
    pub id: String,
    pub nombre: String,
    pub proveedor: String,
    /// Si hay que reconectarla antes de poder abrirla. Se muestra igual: una
    /// cuenta que desaparece de la lista parece una cuenta que se borró.
    pub necesita_reconectarse: bool,
}

/// Las cuentas con archivos en la nube.
///
/// **No pide permiso**: listar es metadatos, y el servicio ya acota lo que
/// devuelve al usuario que pregunta. El permiso se pide al abrir una, que es
/// cuando hace falta la credencial.
#[tauri::command]
pub async fn listar_discos_en_la_nube() -> Result<Vec<DiscoEnLaNube>, String> {
    let conexion = conectar().await?;
    let json: String = llamar(&conexion, "ListAccounts", &()).await?;

    let resumenes: Vec<Resumen> =
        serde_json::from_str(&json).map_err(|e| format!("no se pudo leer la lista: {e}"))?;

    Ok(resumenes
        .into_iter()
        .filter(|r| r.capabilities.iter().any(|c| c == CAPACIDAD))
        .map(|r| DiscoEnLaNube {
            id: r.id,
            nombre: r.display_name,
            proveedor: r.provider_type,
            necesita_reconectarse: r.needs_reauth,
        })
        .collect())
}

/// Lo que hace falta para montar una cuenta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credencial {
    /// La dirección WebDAV, ya en el esquema que entiende gvfs.
    pub uri: String,
    pub usuario: String,
    pub secreto: String,
}

/// El bus del **sistema**: ahí vive el servicio de cuentas, porque los tokens
/// están en archivos de root.
async fn conectar() -> Result<zbus::Connection, String> {
    zbus::Connection::system().await.map_err(|e| {
        format!(
            "no se pudo contactar al gestor de cuentas: {e}. \
             Comprobá que vasak-accounts esté en ejecución."
        )
    })
}

async fn llamar<A>(
    conexion: &zbus::Connection,
    metodo: &str,
    argumentos: &A,
) -> Result<String, String>
where
    A: serde::ser::Serialize + zbus::zvariant::DynamicType,
{
    conexion
        .call_method(Some(SERVICE), PATH, Some(INTERFACE), metodo, argumentos)
        .await
        .map_err(|e| format!("{metodo}: {e}"))?
        .body()
        .deserialize()
        .map_err(|e| format!("respuesta inválida de {metodo}: {e}"))
}

/// Le pide al servicio lo necesario para montar una cuenta.
///
/// **Acá sí se pregunta**, y la primera vez la persona ve el diálogo de permiso.
/// Es el momento correcto: hasta que no quiera abrir el disco, este programa no
/// necesita ninguna credencial suya.
pub async fn credencial_de(account_id: &str) -> Result<Credencial, String> {
    let conexion = conectar().await?;

    // El token primero: es lo que dispara el diálogo, y si la persona dice que
    // no, no tiene sentido haber pedido el resto.
    let secreto: String = llamar(&conexion, "GetAccessToken", &(account_id, CAPACIDAD)).await?;
    let datos: String = llamar(&conexion, "GetAccountData", &(account_id, CAPACIDAD)).await?;

    let datos: serde_json::Value =
        serde_json::from_str(&datos).map_err(|e| format!("no se pudo leer la cuenta: {e}"))?;
    // El servicio devuelve la cuenta entera con la capacidad adentro.
    let config = datos.get("config").unwrap_or(&datos);

    credencial_desde(config, secreto)
}

/// Arma la credencial a partir de lo que guardó el servicio.
pub fn credencial_desde(
    config: &serde_json::Value,
    secreto: String,
) -> Result<Credencial, String> {
    let campo = |nombre: &str| config.get(nombre).and_then(|v| v.as_str());

    let url = campo("url").ok_or(
        "la cuenta no guardó la dirección de sus archivos; \
         volvé a conectarla desde Configuración",
    )?;
    let usuario = campo("username")
        .ok_or("la cuenta no guardó el usuario")?
        .to_string();

    Ok(Credencial { uri: uri_para_gvfs(url)?, usuario, secreto })
}

/// Traduce una dirección WebDAV al esquema que entiende gvfs.
///
/// gvfs no monta `https://`: usa `davs://` para cifrado y `dav://` para sin
/// cifrar. Pasarle la dirección tal cual falla con «esquema no soportado», que
/// no le dice nada a nadie.
///
/// Y `http://` se rechaza: por ahí la contraseña de la cuenta viajaría en claro.
/// El servicio ya exige HTTPS al conectar un Nextcloud, así que una dirección
/// sin cifrar acá es una cuenta armada a mano contra esa recomendación.
pub fn uri_para_gvfs(url: &str) -> Result<String, String> {
    let url = url.trim();

    if let Some(resto) = url.strip_prefix("https://") {
        return Ok(format!("davs://{resto}"));
    }
    if url.starts_with("davs://") {
        return Ok(url.to_string());
    }
    if url.starts_with("http://") || url.starts_with("dav://") {
        return Err(format!(
            "«{url}» no está cifrado, y por ahí la contraseña de la cuenta \
             viajaría a la vista de cualquiera en la red"
        ));
    }
    Err(format!("«{url}» no es una dirección de archivos en la nube"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn se_traduce_al_esquema_que_entiende_gvfs() {
        assert_eq!(
            uri_para_gvfs("https://nube.ejemplo.com/remote.php/dav/files/ana/").unwrap(),
            "davs://nube.ejemplo.com/remote.php/dav/files/ana/"
        );
        // Ya traducida: se deja como está.
        assert_eq!(
            uri_para_gvfs("davs://nube.ejemplo.com/x/").unwrap(),
            "davs://nube.ejemplo.com/x/"
        );
    }

    /// Sin cifrar no se monta: por ahí la contraseña de la cuenta viajaría en
    /// claro. El servicio ya exige HTTPS al conectar, así que llegar acá con
    /// `http://` es una cuenta armada a mano contra esa recomendación.
    #[test]
    fn una_direccion_sin_cifrar_se_rechaza() {
        for malo in ["http://nube.ejemplo.com/dav/", "dav://nube.ejemplo.com/dav/"] {
            let error = uri_para_gvfs(malo).unwrap_err();
            assert!(error.contains("cifrado"), "{malo}: {error}");
        }
    }

    #[test]
    fn lo_que_no_es_una_direccion_se_rechaza() {
        for malo in ["", "   ", "nube.ejemplo.com", "ftp://nube/x", "/home/ana"] {
            assert!(uri_para_gvfs(malo).is_err(), "{malo:?} tenía que rechazarse");
        }
    }

    #[test]
    fn la_credencial_sale_de_lo_que_guardo_el_servicio() {
        let config = json!({
            "url": "https://nube.ejemplo.com/remote.php/dav/files/ana/",
            "username": "ana",
            "auth": "basic",
        });

        let credencial = credencial_desde(&config, "la-contrasena".into()).unwrap();
        assert_eq!(credencial.usuario, "ana");
        assert_eq!(credencial.secreto, "la-contrasena");
        assert!(credencial.uri.starts_with("davs://"));
    }

    /// El mensaje tiene que decir qué hacer. Una cuenta a la que le falta la
    /// dirección se conectó antes de que se guardara, y lo que corresponde es
    /// reconectarla — no un error sobre un campo que la persona nunca vio.
    #[test]
    fn una_cuenta_sin_direccion_dice_que_se_reconecte() {
        let sin_url = json!({ "username": "ana" });
        let error = credencial_desde(&sin_url, "x".into()).unwrap_err();
        assert!(error.contains("volvé a conectarla"), "{error}");
    }

    /// **El límite de este programa.** Pide `drive` y nada más: el correo es de
    /// la aplicación de correo, el calendario de la de calendario.
    ///
    /// `vasak-permissions` lo tiene declarado para este binario, así que un
    /// pedido fuera de ahí se niega sin preguntar. Este test está para que
    /// agregar otra capacidad acá sea una decisión y no un descuido.
    #[test]
    fn este_programa_solo_pide_los_archivos() {
        assert_eq!(CAPACIDAD, "drive");
    }

    /// Sólo las cuentas que tienen archivos aparecen en la barra lateral. Una de
    /// correo no tiene nada que abrir acá.
    #[test]
    fn solo_se_listan_las_cuentas_con_archivos() {
        let json = r#"[
            {"id":"a","display_name":"Nube","provider_type":"nextcloud",
             "capabilities":["drive","calendar"],"needs_reauth":false},
            {"id":"b","display_name":"Correo","provider_type":"custom",
             "capabilities":["email"],"needs_reauth":false}
        ]"#;
        let resumenes: Vec<Resumen> = serde_json::from_str(json).unwrap();

        let con_archivos: Vec<&Resumen> = resumenes
            .iter()
            .filter(|r| r.capabilities.iter().any(|c| c == CAPACIDAD))
            .collect();

        assert_eq!(con_archivos.len(), 1);
        assert_eq!(con_archivos[0].id, "a");
    }

    /// Una cuenta que hay que reconectar **sí** se muestra, marcada. Sacarla de
    /// la lista parecería que se borró, y la persona no sabría que le falta
    /// hacer algo.
    #[test]
    fn una_cuenta_que_pide_reconexion_se_muestra_marcada() {
        let json = r#"[{"id":"a","display_name":"Nube","provider_type":"nextcloud",
                        "capabilities":["drive"],"needs_reauth":true}]"#;
        let resumenes: Vec<Resumen> = serde_json::from_str(json).unwrap();
        assert!(resumenes[0].needs_reauth);
    }
}
