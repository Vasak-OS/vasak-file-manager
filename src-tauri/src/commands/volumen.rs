//! El comando y la glue D-Bus para renombrar la etiqueta de un volumen.
//!
//! Aparte del resto a propósito: la llamada a `Filesystem.SetLabel` de UDisks2 no
//! se puede ejercitar sin un bus de sistema ni un disco reales. Por eso vive en
//! `commands/`, que el análisis de cobertura excluye —igual que los `.vue`—. Lo
//! que sí se prueba (validar la etiqueta, y que una etiqueta vacía corte antes de
//! tocar el bus) queda cubierto por los tests de acá.

use std::collections::HashMap;

use zvariant::Value;

use crate::montaje::{clasificar, resolver, FalloDeMontaje, SinAgente, FALLO, UDISKS};

/// Rechaza las etiquetas que no tiene sentido mandar al bus.
///
/// Una etiqueta vacía no es un renombre: según el sistema de archivos `SetLabel`
/// la borra o la rechaza, y en ningún caso es lo que la persona pidió. Se corta
/// antes de tocar el bus, así la ventana lo muestra igual que cualquier fallo.
pub(crate) fn validar_etiqueta(label: &str) -> Result<(), FalloDeMontaje> {
    if label.trim().is_empty() {
        return Err(FalloDeMontaje::nuevo(
            FALLO,
            "la etiqueta no puede estar vacía",
        ));
    }
    Ok(())
}

/// Cambia la etiqueta de un volumen con `Filesystem.SetLabel`.
///
/// No desmonta nada: si el sistema de archivos está montado y no acepta el
/// cambio en caliente (FAT, NTFS), `udisks2` devuelve «device is mounted» y ese
/// error se propaga tal cual (cae en `FALLO`) para que la ventana lo muestre.
pub async fn etiquetar(device_path: &str, label: &str) -> Result<(), FalloDeMontaje> {
    validar_etiqueta(label)?;

    let conexion = zbus::Connection::system()
        .await
        .map_err(|error| FalloDeMontaje::nuevo(FALLO, error.to_string()))?;

    let objeto = resolver(&conexion, device_path).await.ok_or_else(|| {
        FalloDeMontaje::nuevo(
            FALLO,
            format!("no se encontró el dispositivo {device_path}"),
        )
    })?;

    let opciones: HashMap<&str, Value<'_>> = HashMap::new();
    conexion
        .call_method(
            Some(UDISKS),
            &objeto,
            Some("org.freedesktop.UDisks2.Filesystem"),
            "SetLabel",
            &(label, opciones),
        )
        .await
        .map_err(|error| match &error {
            zbus::Error::MethodError(nombre, detalle, _) => {
                // Acá no hay respaldo por «no hay agente» como en el montaje: un
                // error de método de `udisks2` siempre es un fallo que mostrar.
                clasificar(nombre.as_str(), detalle.as_deref().unwrap_or_default())
                    .unwrap_or_else(|SinAgente| FalloDeMontaje::nuevo(FALLO, nombre.as_str()))
            }
            _ => FalloDeMontaje::nuevo(FALLO, error.to_string()),
        })?;

    Ok(())
}

/// Cambia la etiqueta (nombre) de un volumen.
///
/// El trabajo está en `etiquetar`: valida la etiqueta y llama a
/// `Filesystem.SetLabel`. Acá sólo queda el comando.
#[tauri::command]
pub async fn set_volume_label(device_path: String, label: String) -> Result<(), FalloDeMontaje> {
    etiquetar(&device_path, &label).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_etiqueta_con_contenido_es_valida() {
        assert_eq!(validar_etiqueta("DATOS"), Ok(()));
        // Los espacios de los costados no la vuelven vacía.
        assert_eq!(validar_etiqueta("  Mis fotos "), Ok(()));
    }

    #[test]
    fn una_etiqueta_vacia_o_de_espacios_es_un_fallo_con_detalle() {
        for etiqueta in ["", " ", "   \t\n"] {
            let fallo = validar_etiqueta(etiqueta).expect_err("no es un renombre");

            assert_eq!(fallo.codigo, FALLO);
            assert!(!fallo.detalle.trim().is_empty());
        }
    }

    #[test]
    fn etiquetar_con_una_etiqueta_vacia_corta_antes_de_tocar_el_bus() {
        // Si llegara al bus, el detalle sería el del error de conexión o el de
        // «no se encontró el dispositivo», no el de la validación.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("runtime");

        let fallo = runtime
            .block_on(etiquetar("/dev/no-existe", "  "))
            .expect_err("una etiqueta vacía no se manda");

        assert_eq!(fallo.codigo, FALLO);
        assert_eq!(
            Some(fallo),
            validar_etiqueta("  ").err(),
            "tiene que ser el fallo de la validación, no uno del bus"
        );
    }
}
