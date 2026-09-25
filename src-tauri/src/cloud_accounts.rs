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
//!
//! ── Lo que todavía no está ──────────────────────────────────────────────────
//!
//! Sólo se monta lo que habla WebDAV. Google Drive se ofrece como capacidad
//! `drive`, pero no tiene dirección WebDAV, y la API propia no está
//! implementada (decisión en `vasak-accounts#24`: lo que no está implementado
//! se ve **no disponible**, nunca roto). El servicio lo dice por cuenta en
//! `unavailable_capabilities`, y acá se muestra así: la cuenta se lista,
//! atenuada, y abrirla no monta nada — dice que todavía no está.

use serde::{Deserialize, Serialize};

const SERVICE: &str = "ar.net.vasak.os.AccountManager";
const PATH: &str = "/ar/net/vasak/os/AccountManager";
const INTERFACE: &str = "ar.net.vasak.os.AccountManager";

/// La capacidad que este programa puede pedir. La única.
const CAPABILITY: &str = "drive";

/// El resumen de una cuenta, tal como lo devuelve `ListAccounts`.
#[derive(Debug, Clone, Deserialize)]
struct AccountSummary {
    id: String,
    display_name: String,
    provider_type: String,
    capabilities: Vec<String>,
    #[serde(default)]
    needs_reauth: bool,
    /// Las capacidades de la cuenta cuyo proveedor hoy no tiene dirección
    /// (subconjunto de `capabilities`). Un demonio viejo no manda el campo, y
    /// entonces queda vacío: nada se marca, que es lo que pasaba antes.
    #[serde(default)]
    unavailable_capabilities: Vec<String>,
}

impl AccountSummary {
    fn has_files(&self) -> bool {
        self.capabilities.iter().any(|c| c == CAPABILITY)
    }

    fn files_unavailable(&self) -> bool {
        self.unavailable_capabilities
            .iter()
            .any(|c| c == CAPABILITY)
    }
}

/// Un disco en la nube listo para mostrarse en la barra lateral.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudDrive {
    pub id: String,
    pub name: String,
    pub provider: String,
    /// Si hay que reconectarla antes de poder abrirla. Se muestra igual: una
    /// cuenta que desaparece de la lista parece una cuenta que se borró.
    pub needs_reconnect: bool,
    /// Si los archivos de este proveedor todavía no se pueden abrir en
    /// VasakOS. Se muestra igual, por el mismo motivo que la de arriba, pero
    /// no se monta: no hay nada que montar.
    pub unavailable: bool,
}

/// Las cuentas con archivos en la nube.
///
/// **No pide permiso**: listar es metadatos, y el servicio ya acota lo que
/// devuelve al usuario que pregunta. El permiso se pide al abrir una, que es
/// cuando hace falta la credencial.
#[tauri::command]
pub async fn list_cloud_drives() -> Result<Vec<CloudDrive>, String> {
    let connection = connect().await?;
    drives_from_service(&connection).await
}

/// Le pide al servicio la lista y la deja en discos.
async fn drives_from_service(connection: &zbus::Connection) -> Result<Vec<CloudDrive>, String> {
    let json: String = call(connection, "ListAccounts", &()).await?;
    let summaries: Vec<AccountSummary> =
        serde_json::from_str(&json).map_err(|e| format!("no se pudo leer la lista: {e}"))?;
    Ok(drives_from(summaries))
}

/// Los resúmenes que tienen archivos, convertidos en discos.
///
/// Separado del bus para poder probarlo: es la única lógica de la lista.
fn drives_from(summaries: Vec<AccountSummary>) -> Vec<CloudDrive> {
    summaries
        .into_iter()
        .filter(AccountSummary::has_files)
        .map(|summary| CloudDrive {
            unavailable: summary.files_unavailable(),
            id: summary.id,
            name: summary.display_name,
            provider: summary.provider_type,
            needs_reconnect: summary.needs_reauth,
        })
        .collect()
}

/// Por qué no se pudo abrir un disco en la nube, tal como le llega a la ventana.
///
/// Un código y no un texto, igual que al montar las unidades locales: el
/// backend no sabe en qué idioma está la ventana, y un mensaje escrito acá
/// saldría en español para todo el mundo. La ventana traduce el código a una
/// clave del catálogo; el detalle va igual, tal cual, para quien quiera saber
/// qué dijo gvfs o el servicio de cuentas.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CloudMountError {
    pub code: String,
    pub detail: String,
}

impl CloudMountError {
    /// Los archivos de este proveedor todavía no se pueden abrir en VasakOS.
    /// No hay nada que la persona pueda hacer, así que no se le pide nada.
    pub const NOT_AVAILABLE_YET: &'static str = "notAvailableYet";
    /// La cuenta quedó incompleta o el servidor ya no la acepta: reconectarla
    /// desde Configuración es lo que la arregla.
    pub const NEEDS_RECONNECT: &'static str = "needsReconnect";
    /// Todo lo demás. El detalle es lo que dijo quien falló, sin tocar.
    pub const FAILED: &'static str = "failed";

    fn new(code: &str, detail: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            detail: detail.into(),
        }
    }

    pub fn not_available_yet(provider: &str) -> Self {
        Self::new(
            Self::NOT_AVAILABLE_YET,
            format!("{provider}: sin dirección WebDAV ni API propia implementada"),
        )
    }

    pub fn needs_reconnect(detail: impl Into<String>) -> Self {
        Self::new(Self::NEEDS_RECONNECT, detail)
    }

    pub fn failed(detail: impl Into<String>) -> Self {
        Self::new(Self::FAILED, detail)
    }
}

/// Un error interno —del bus, de gvfs, de una respuesta que no se pudo leer—
/// es un `failed` con el texto tal cual. Así el `?` sobre los ayudantes que
/// devuelven `String` no obliga a envolver cada llamada a mano, y ninguno se
/// convierte por accidente en otra cosa: los códigos con significado se
/// eligen explícitamente.
impl From<String> for CloudMountError {
    fn from(detail: String) -> Self {
        Self::failed(detail)
    }
}

/// Lo que hace falta para montar una cuenta.
///
/// **Sin `Debug` derivado**, a propósito: `secret` es la contraseña o el token
/// de la cuenta, y un `Debug` derivado lo escribiría entero en cualquier
/// registro, en cualquier `dbg!` de paso, y en el mensaje de cualquier pánico
/// que la lleve adentro. Se implementa a mano y se tacha.
#[derive(Clone, PartialEq, Eq)]
pub struct Credential {
    /// La dirección WebDAV, ya en el esquema que entiende gvfs.
    pub uri: String,
    pub username: String,
    pub secret: String,
}

impl std::fmt::Debug for Credential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credential")
            .field("uri", &self.uri)
            .field("username", &self.username)
            .field("secret", &"<tachado>")
            .finish()
    }
}

/// El bus del **sistema**: ahí vive el servicio de cuentas, porque los tokens
/// están en archivos de root.
async fn connect() -> Result<zbus::Connection, String> {
    zbus::Connection::system().await.map_err(|e| {
        format!(
            "no se pudo contactar al gestor de cuentas: {e}. \
             Comprobá que vasak-accounts esté en ejecución."
        )
    })
}

async fn call<A>(
    connection: &zbus::Connection,
    method: &str,
    arguments: &A,
) -> Result<String, String>
where
    A: serde::ser::Serialize + zbus::zvariant::DynamicType,
{
    connection
        .call_method(Some(SERVICE), PATH, Some(INTERFACE), method, arguments)
        .await
        .map_err(|e| format!("{method}: {e}"))?
        .body()
        .deserialize()
        .map_err(|e| format!("respuesta inválida de {method}: {e}"))
}

/// Le pide al servicio lo necesario para montar una cuenta.
///
/// **Acá sí se pregunta**, y la primera vez la persona ve el diálogo de permiso.
/// Es el momento correcto: hasta que no quiera abrir el disco, este programa no
/// necesita ninguna credencial suya.
///
/// Salvo que no haya nada que montar: una cuenta cuyos archivos todavía no
/// están disponibles se corta **antes** de pedir el token, así el diálogo de
/// permiso no aparece por algo que no puede andar.
pub async fn credential_of(account_id: &str) -> Result<Credential, CloudMountError> {
    let connection = connect().await?;

    // La lista no pide permiso, y es lo que dice si vale la pena seguir.
    let drive = drives_from_service(&connection)
        .await?
        .into_iter()
        .find(|drive| drive.id == account_id)
        .ok_or_else(|| {
            CloudMountError::failed("la cuenta ya no tiene archivos en la nube, o se borró")
        })?;
    if drive.unavailable {
        return Err(CloudMountError::not_available_yet(&drive.provider));
    }

    // El token primero: es lo que dispara el diálogo, y si la persona dice que
    // no, no tiene sentido haber pedido el resto.
    let secret: String = call(&connection, "GetAccessToken", &(account_id, CAPABILITY)).await?;
    let data: String = call(&connection, "GetAccountData", &(account_id, CAPABILITY)).await?;

    let data: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("no se pudo leer la cuenta: {e}"))?;
    // El servicio devuelve la cuenta entera con la capacidad adentro.
    let config = data.get("config").unwrap_or(&data);

    credential_from(config, secret, &drive)
}

/// Arma la credencial a partir de lo que guardó el servicio.
///
/// Sin `url` no hay nada que montar, y hay dos motivos distintos que se dicen
/// distinto: si el proveedor todavía no tiene dirección en VasakOS, reconectar
/// la cuenta no arregla nada y decirlo sería mandar a la persona a dar
/// vueltas; si la tiene, la cuenta se guardó incompleta y reconectarla es
/// justamente lo que la arregla.
pub fn credential_from(
    config: &serde_json::Value,
    secret: String,
    drive: &CloudDrive,
) -> Result<Credential, CloudMountError> {
    let field = |name: &str| config.get(name).and_then(|v| v.as_str());

    let url = match field("url") {
        Some(url) => url,
        None if drive.unavailable => {
            return Err(CloudMountError::not_available_yet(&drive.provider))
        }
        None => {
            return Err(CloudMountError::needs_reconnect(
                "la cuenta no guardó la dirección de sus archivos",
            ))
        }
    };
    // Lo mismo que sin dirección: la cuenta se guardó incompleta, y
    // reconectarla es lo que la completa.
    let username = field("username")
        .ok_or_else(|| CloudMountError::needs_reconnect("la cuenta no guardó el usuario"))?
        .to_string();

    Ok(Credential {
        uri: gvfs_uri(url)?,
        username,
        secret,
    })
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
pub fn gvfs_uri(url: &str) -> Result<String, String> {
    let url = url.trim();

    if let Some(rest) = url.strip_prefix("https://") {
        return Ok(format!("davs://{rest}"));
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
    Err(format!(
        "«{url}» no es una dirección de archivos en la nube"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Un disco de Nextcloud que anda; cada prueba cambia sólo lo suyo.
    fn a_drive() -> CloudDrive {
        CloudDrive {
            id: "a".into(),
            name: "Nube".into(),
            provider: "nextcloud".into(),
            needs_reconnect: false,
            unavailable: false,
        }
    }

    #[test]
    fn se_traduce_al_esquema_que_entiende_gvfs() {
        assert_eq!(
            gvfs_uri("https://nube.ejemplo.com/remote.php/dav/files/ana/").unwrap(),
            "davs://nube.ejemplo.com/remote.php/dav/files/ana/"
        );
        // Ya traducida: se deja como está.
        assert_eq!(
            gvfs_uri("davs://nube.ejemplo.com/x/").unwrap(),
            "davs://nube.ejemplo.com/x/"
        );
    }

    /// Sin cifrar no se monta: por ahí la contraseña de la cuenta viajaría en
    /// claro. El servicio ya exige HTTPS al conectar, así que llegar acá con
    /// `http://` es una cuenta armada a mano contra esa recomendación.
    #[test]
    fn una_direccion_sin_cifrar_se_rechaza() {
        for bad in [
            "http://nube.ejemplo.com/dav/",
            "dav://nube.ejemplo.com/dav/",
        ] {
            let error = gvfs_uri(bad).unwrap_err();
            assert!(error.contains("cifrado"), "{bad}: {error}");
        }
    }

    #[test]
    fn lo_que_no_es_una_direccion_se_rechaza() {
        for bad in ["", "   ", "nube.ejemplo.com", "ftp://nube/x", "/home/ana"] {
            assert!(gvfs_uri(bad).is_err(), "{bad:?} tenía que rechazarse");
        }
    }

    #[test]
    fn la_credencial_sale_de_lo_que_guardo_el_servicio() {
        let config = json!({
            "url": "https://nube.ejemplo.com/remote.php/dav/files/ana/",
            "username": "ana",
            "auth": "basic",
        });

        let credential = credential_from(&config, "la-contrasena".into(), &a_drive()).unwrap();
        assert_eq!(credential.username, "ana");
        assert_eq!(credential.secret, "la-contrasena");
        assert!(credential.uri.starts_with("davs://"));
    }

    /// El mensaje tiene que decir qué hacer. Una cuenta a la que le falta la
    /// dirección se conectó antes de que se guardara, y lo que corresponde es
    /// reconectarla — no un error sobre un campo que la persona nunca vio.
    #[test]
    fn una_cuenta_sin_direccion_dice_que_se_reconecte() {
        let without_url = json!({ "username": "ana" });
        let error = credential_from(&without_url, "x".into(), &a_drive()).unwrap_err();
        assert_eq!(error.code, CloudMountError::NEEDS_RECONNECT, "{error:?}");
    }

    /// Sin usuario pasa lo mismo que sin dirección: la cuenta se guardó a
    /// medias, y reconectarla es lo que la completa.
    #[test]
    fn una_cuenta_sin_usuario_dice_que_se_reconecte() {
        let without_username = json!({ "url": "https://nube.ejemplo.com/dav/" });
        let error = credential_from(&without_username, "x".into(), &a_drive()).unwrap_err();
        assert_eq!(error.code, CloudMountError::NEEDS_RECONNECT, "{error:?}");
    }

    /// Una dirección sin cifrar es un fallo con su motivo, no una cuenta para
    /// reconectar: reconectarla traería la misma dirección.
    #[test]
    fn una_direccion_sin_cifrar_falla_con_su_motivo() {
        let config = json!({ "url": "http://nube.ejemplo.com/dav/", "username": "ana" });
        let error = credential_from(&config, "x".into(), &a_drive()).unwrap_err();
        assert_eq!(error.code, CloudMountError::FAILED);
        assert!(error.detail.contains("cifrado"), "{error:?}");
    }

    /// Pero si el proveedor todavía no tiene dirección en VasakOS —Google
    /// Drive—, mandar a reconectar es mentir: reconectar no trae ninguna
    /// dirección. Se dice que todavía no está, con el nombre del proveedor y
    /// sin inventar un `davs://`.
    #[test]
    fn una_cuenta_sin_direccion_y_no_disponible_dice_que_todavia_no_esta() {
        let without_url = json!({ "username": "ana" });
        let drive = CloudDrive {
            provider: "google".into(),
            unavailable: true,
            ..a_drive()
        };
        let result = credential_from(&without_url, "x".into(), &drive);
        let error = match result {
            Err(error) => error,
            Ok(credential) => panic!("se inventó una dirección: {}", credential.uri),
        };
        assert_eq!(error.code, CloudMountError::NOT_AVAILABLE_YET, "{error:?}");
        assert!(error.detail.contains("google"), "{error:?}");
    }

    /// Lo que viaja a la ventana es `{"code":…,"detail":…}`: es lo que lee
    /// `cloudMountErrorMessage`. Un campo con otro nombre llegaría como
    /// `undefined`, y la ventana lo trataría como un error sin forma.
    #[test]
    fn el_error_viaja_con_codigo_y_detalle() {
        let json = serde_json::to_value(CloudMountError::not_available_yet("google")).unwrap();
        assert_eq!(json["code"], "notAvailableYet");
        assert!(json["detail"].as_str().unwrap().contains("google"));
        assert_eq!(json.as_object().unwrap().len(), 2, "{json}");

        let json = serde_json::to_value(CloudMountError::needs_reconnect("x")).unwrap();
        assert_eq!(json, json!({ "code": "needsReconnect", "detail": "x" }));
    }

    /// Un error interno se vuelve `failed` con el texto tal cual: ni se pierde
    /// ni se disfraza de otro código.
    #[test]
    fn un_error_interno_es_un_fallo_con_su_texto() {
        let error = CloudMountError::from("ListAccounts: el servicio no contesta".to_string());
        assert_eq!(
            error,
            CloudMountError {
                code: "failed".into(),
                detail: "ListAccounts: el servicio no contesta".into(),
            }
        );
    }

    /// El secreto no puede aparecer en un registro ni en un pánico.
    ///
    /// Con `Debug` derivado se escribiría entero en cualquier lado que formatee
    /// la credencial — y eso incluye lugares que nadie eligió, como el mensaje
    /// de un pánico.
    #[test]
    fn el_secreto_no_se_imprime() {
        let credential = Credential {
            uri: "davs://nube.ejemplo.com/x/".into(),
            username: "ana".into(),
            secret: "la-contrasena-de-verdad".into(),
        };

        let printed = format!("{credential:?}");
        assert!(!printed.contains("la-contrasena-de-verdad"), "{printed}");
        // Y lo que sí sirve para diagnosticar se sigue viendo.
        assert!(printed.contains("davs://nube.ejemplo.com/x/"), "{printed}");
        assert!(printed.contains("ana"), "{printed}");
    }

    /// **El límite de este programa.** Pide `drive` y nada más: el correo es de
    /// la aplicación de correo, el calendario de la de calendario.
    ///
    /// `vasak-permissions` lo tiene declarado para este binario, así que un
    /// pedido fuera de ahí se niega sin preguntar. Este test está para que
    /// agregar otra capacidad acá sea una decisión y no un descuido.
    #[test]
    fn este_programa_solo_pide_los_archivos() {
        assert_eq!(CAPABILITY, "drive");
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
        let summaries: Vec<AccountSummary> = serde_json::from_str(json).unwrap();

        let drives = drives_from(summaries);

        assert_eq!(drives.len(), 1);
        assert_eq!(drives[0].id, "a");
        assert_eq!(drives[0].name, "Nube");
        assert_eq!(drives[0].provider, "nextcloud");
    }

    /// Una cuenta que hay que reconectar **sí** se muestra, marcada. Sacarla de
    /// la lista parecería que se borró, y la persona no sabría que le falta
    /// hacer algo.
    #[test]
    fn una_cuenta_que_pide_reconexion_se_muestra_marcada() {
        let json = r#"[{"id":"a","display_name":"Nube","provider_type":"nextcloud",
                        "capabilities":["drive"],"needs_reauth":true}]"#;
        let summaries: Vec<AccountSummary> = serde_json::from_str(json).unwrap();

        let drives = drives_from(summaries);
        assert!(drives[0].needs_reconnect);
        assert!(!drives[0].unavailable);
    }

    /// Una cuenta cuyos archivos el servicio marca como no disponibles
    /// **también** se muestra, marcada: el mismo criterio que la de arriba. Lo
    /// que cambia es que no se monta.
    #[test]
    fn una_cuenta_con_archivos_no_disponibles_se_muestra_marcada() {
        let json = r#"[{"id":"g","display_name":"Drive de Ana","provider_type":"google",
                        "capabilities":["drive","email"],
                        "unavailable_capabilities":["drive"]}]"#;
        let summaries: Vec<AccountSummary> = serde_json::from_str(json).unwrap();

        let drives = drives_from(summaries);
        assert_eq!(drives.len(), 1);
        assert!(drives[0].unavailable);
        assert!(!drives[0].needs_reconnect);
    }

    /// Que otra capacidad no esté disponible no toca a los archivos: `drive`
    /// se marca sólo si `drive` está en la lista.
    #[test]
    fn otra_capacidad_no_disponible_no_marca_los_archivos() {
        let json = r#"[{"id":"n","display_name":"Nube","provider_type":"nextcloud",
                        "capabilities":["drive","calendar"],
                        "unavailable_capabilities":["calendar"]}]"#;
        let summaries: Vec<AccountSummary> = serde_json::from_str(json).unwrap();

        assert!(!drives_from(summaries)[0].unavailable);
    }

    /// Un demonio viejo no manda `unavailable_capabilities`. La lista se lee
    /// igual y nada queda marcado: exactamente lo que pasaba antes.
    #[test]
    fn sin_el_campo_del_demonio_viejo_nada_queda_marcado() {
        let json = r#"[{"id":"g","display_name":"Drive de Ana","provider_type":"google",
                        "capabilities":["drive"],"needs_reauth":false}]"#;
        let summaries: Vec<AccountSummary> = serde_json::from_str(json).unwrap();

        let drives = drives_from(summaries);
        assert_eq!(drives.len(), 1);
        assert!(!drives[0].unavailable);
    }

    /// El JSON que llega a la ventana va en camelCase, que es como lo lee el
    /// composable. Un campo en snake_case del lado de Rust y en camelCase del
    /// lado de Vue se ve como `undefined`, y `undefined` es falso: la cuenta
    /// aparecería como si anduviera.
    #[test]
    fn el_disco_viaja_en_camel_case() {
        let drive = CloudDrive {
            needs_reconnect: true,
            unavailable: true,
            ..a_drive()
        };
        let json = serde_json::to_value(&drive).unwrap();
        assert_eq!(json["needsReconnect"], true);
        assert_eq!(json["unavailable"], true);
        assert_eq!(json["name"], "Nube");
        assert_eq!(json["provider"], "nextcloud");
        assert!(json.get("needs_reconnect").is_none());
    }
}
