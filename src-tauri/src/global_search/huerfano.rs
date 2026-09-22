//! Borra el índice que esta aplicación dejó en su directorio de datos.
//!
//! # Por qué hay uno tirado
//!
//! El índice de la búsqueda global vivió un tiempo en el directorio de datos de
//! esta aplicación —`~/.local/share/ar.net.vasak.vasak-file-manager/`— y después
//! se mudó a la caché compartida de VasakOS, que es donde corresponde: es
//! contenido derivado y no es de una sola aplicación. La mudanza escribió en el
//! lugar nuevo y **no borró el viejo**, porque mientras el gestor seguía siendo
//! el dueño convenía dejarlo por si había que volver.
//!
//! Ahora el dueño es `vasak-prism` y ya nadie va a volver ahí. Lo que queda son
//! nueve megas de un índice congelado el día de la mudanza, en un directorio que
//! nadie mira: no molesta, no falla, y no se va nunca solo.
//!
//! # Por qué lo borra la aplicación y no la receta
//!
//! Porque el directorio es **de cada usuario** y el paquete se instala como
//! root: un `post_install` tendría que adivinar quiénes son los usuarios de la
//! máquina y escribir en sus casas. La aplicación, en cambio, corre como quien
//! la usa y sabe exactamente cuál es su directorio.
//!
//! # Y por qué no borra la caché compartida por error
//!
//! Porque no la nombra. Esto sólo conoce la ruta vieja, que cuelga del
//! identificador de esta aplicación; la nueva está en otro árbol y la arma el
//! contrato. Si alguien las confundiera, el borrado se llevaría puesto el índice
//! que el lanzador acaba de escribir — de ahí que la ruta se arme acá y no se
//! reciba de ningún lado.

use std::path::{Path, PathBuf};

/// El identificador de esta aplicación, que es su directorio de datos.
const IDENTIFICADOR: &str = "ar.net.vasak.vasak-file-manager";

/// Lo que se borra: el subdirectorio del índice, no el directorio de datos.
const SUBDIRECTORIO: &str = "global-search";

/// Dónde quedó el índice viejo, si se puede saber.
pub fn ruta() -> Option<PathBuf> {
    ruta_bajo(dirs::data_dir())
}

/// Lo mismo, recibiendo la base en vez de leerla del entorno.
///
/// Aparte porque el entorno es global al proceso y las pruebas corren en
/// paralelo. Y con el filtro de siempre: `dirs` comprueba que `HOME` no esté
/// vacío, no que sea absoluto, y acá eso importa más que en otros lados —esto
/// **borra un directorio**, así que una base relativa lo resolvería contra el
/// directorio de trabajo, que es cualquiera.
pub fn ruta_bajo(base: Option<PathBuf>) -> Option<PathBuf> {
    let base = base.filter(|ruta| ruta.is_absolute())?;
    Some(base.join(IDENTIFICADOR).join(SUBDIRECTORIO))
}

/// Lo borra si está. Devuelve si había algo que borrar.
///
/// No es un error que falle: es espacio de más, no algo que rompa nada. Se
/// vuelve a intentar el próximo arranque.
pub fn limpiar(ruta: &Path) -> bool {
    if !ruta.is_dir() {
        return false;
    }
    std::fs::remove_dir_all(ruta).is_ok()
}

/// Lo de arriba, en el lugar de siempre.
pub fn limpiar_el_de_siempre() {
    if let Some(ruta) = ruta() {
        limpiar(&ruta);
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn la_ruta_es_la_del_directorio_de_datos_de_esta_aplicacion() {
        assert_eq!(
            ruta_bajo(Some(PathBuf::from("/casa/.local/share"))),
            Some(PathBuf::from(
                "/casa/.local/share/ar.net.vasak.vasak-file-manager/global-search"
            ))
        );
    }

    #[test]
    fn nunca_apunta_a_la_cache_compartida() {
        // El error que no se puede cometer: si esto llegara a dar la ruta del
        // índice nuevo, el arranque del gestor borraría lo que el lanzador
        // acaba de escribir, y el lanzador lo rehace, y así para siempre.
        let vieja = ruta_bajo(Some(PathBuf::from("/casa/.local/share"))).unwrap();
        let nueva = super::super::contrato::directorio_del_indice(Path::new("/casa/.cache/vasak"));

        assert_ne!(vieja, nueva);
        assert!(!nueva.starts_with(&vieja), "la nueva no cuelga de la vieja");
        assert!(
            !vieja.to_string_lossy().contains("cache"),
            "y la vieja no toca la caché"
        );
    }

    #[test]
    fn una_base_que_no_es_absoluta_no_da_ruta() {
        // Acá pesa más que en otros lados: esto borra un directorio entero, y
        // una ruta relativa se resolvería contra el directorio de trabajo.
        for base in ["", "datos", "./datos", "../datos"] {
            assert_eq!(ruta_bajo(Some(PathBuf::from(base))), None, "«{base}»");
        }
        assert_eq!(ruta_bajo(None), None);
    }

    #[test]
    fn borra_lo_que_hay_y_no_se_queja_de_lo_que_no() {
        let base = std::env::temp_dir().join(format!(
            "vasak-huerfano-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        let viejo = base.join("global-search").join("index");
        std::fs::create_dir_all(&viejo).unwrap();
        std::fs::write(viejo.join("meta.json"), b"{}").unwrap();

        let objetivo = base.join("global-search");
        assert!(limpiar(&objetivo), "había algo que borrar");
        assert!(!objetivo.exists());

        assert!(!limpiar(&objetivo), "y la segunda vez ya no hay nada");

        let _ = std::fs::remove_dir_all(&base);
    }
}
