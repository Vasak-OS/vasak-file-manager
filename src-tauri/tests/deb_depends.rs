//! Que la lista de dependencias del `.deb` sea de Debian y de esta aplicación.
//!
//! La lista venía copiada de la plantilla `vapp`: declaraba `libsoup2.4-1` y
//! `libsoup-3.0-0` a la vez —las dos generaciones, y el binario sólo enlaza la
//! 3—, un `librsvg2-devel` y dos gstreamer con nombres de Fedora que en Debian no
//! existen —así que el paquete no se podía instalar—, y le faltaban
//! `libdbus-1-3` y `libjavascriptcoregtk-4.1-0`, que el binario sí enlaza.
//!
//! Lo que se declara se audita con `readelf -d … | grep NEEDED`, nunca con
//! `ldd`. Estas pruebas no reemplazan esa auditoría: cuidan que no vuelva a
//! entrar lo que ya se sacó y que no falte lo que se sabe que se enlaza.
//!
//! Además de lo que se enlaza están los programas que se lanzan: los
//! compresores de `compress.rs` y `extract.rs`. Ésos no aparecen en `readelf`,
//! así que se sacan del código mismo y se cruzan con `ARCHIVE_TOOLS`.

use std::path::PathBuf;

fn deb_list(field: &str) -> Vec<String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", path.display()));
    let config: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("{} no es JSON válido: {e}", path.display()));
    config["bundle"]["linux"]["deb"][field]
        .as_array()
        .unwrap_or_else(|| panic!("bundle.linux.deb.{field} tiene que existir"))
        .iter()
        .map(|v| {
            v.as_str()
                .expect("cada dependencia es un texto")
                .to_string()
        })
        .collect()
}

fn deb_depends() -> Vec<String> {
    deb_list("depends")
}

fn deb_recommends() -> Vec<String> {
    deb_list("recommends")
}

/// Si `name` tiene la forma de un nombre de paquete de Debian: minúsculas,
/// dígitos y `+-.`, empezando por una letra o un dígito.
fn is_debian_name(name: &str) -> bool {
    name.len() >= 2
        && name
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "+-.".contains(c))
}

#[test]
fn las_dependencias_del_deb_tienen_nombre_de_debian() {
    for name in deb_depends() {
        assert!(
            is_debian_name(&name),
            "«{name}» no es un nombre de paquete de Debian"
        );
        // `-devel` y `gstreamer1-*` son nombres de Fedora: en Debian no existen
        // y el paquete no se podría instalar.
        assert!(
            !name.ends_with("-devel") && !name.starts_with("gstreamer1-"),
            "«{name}» es un nombre de Fedora, no de Debian"
        );
        assert!(
            !name.ends_with("-dev"),
            "«{name}» es de compilación: el paquete instalado no lo usa"
        );
    }
}

#[test]
fn las_dependencias_del_deb_no_se_repiten() {
    let depends = deb_depends();
    let mut seen = std::collections::BTreeSet::new();
    for name in &depends {
        assert!(seen.insert(name), "«{name}» está dos veces");
    }
}

/// El binario enlaza libsoup 3 y nada más: la 2.4 viene de la plantilla.
#[test]
fn no_viajan_las_dos_generaciones_de_libsoup() {
    let depends = deb_depends();
    assert!(
        !depends.iter().any(|n| n == "libsoup2.4-1"),
        "libsoup2.4-1 no la enlaza nadie: el binario usa libsoup-3.0"
    );
}

/// Lo que `readelf -d` muestra enlazado, con su paquete de Debian. Si una de
/// éstas deja de enlazarse, se saca de la lista y de acá a la vez.
#[test]
fn estan_las_bibliotecas_que_el_binario_enlaza() {
    let depends = deb_depends();
    for (soname, package) in [
        ("libcairo.so.2", "libcairo2"),
        ("libdbus-1.so.3", "libdbus-1-3"),
        ("libgdk_pixbuf-2.0.so.0", "libgdk-pixbuf-2.0-0"),
        ("libglib-2.0.so.0", "libglib2.0-0t64"),
        ("libgtk-3.so.0", "libgtk-3-0t64"),
        (
            "libjavascriptcoregtk-4.1.so.0",
            "libjavascriptcoregtk-4.1-0",
        ),
        ("libsoup-3.0.so.0", "libsoup-3.0-0"),
        ("libwebkit2gtk-4.1.so.0", "libwebkit2gtk-4.1-0"),
    ] {
        assert!(
            depends.iter().any(|n| n == package),
            "el binario enlaza {soname} y el .deb no declara {package}"
        );
    }
}

/// Lo que no se enlaza pero sin lo cual la aplicación no hace lo suyo: montar
/// los discos en la nube (el backend WebDAV de gvfs y el servicio de cuentas) y
/// las unidades locales (udisks2). Son las mismas que declara la receta de Arch.
#[test]
fn estan_los_servicios_que_se_usan_sin_enlazarlos() {
    let depends = deb_depends();
    for package in [
        "gvfs-backends",
        "vasak-accounts",
        "udisks2",
        "shared-mime-info",
    ] {
        assert!(
            depends.iter().any(|n| n == package),
            "falta {package} en el .deb"
        );
    }
}

/// Los programas externos con los que se comprime y se descomprime, con el
/// paquete de Debian que los trae y cómo se declara.
///
/// `tar` y `gzip` son `Essential: yes` en Debian: están en toda instalación y la
/// política pide no declararlos (lintian avisa con
/// `depends-on-essential-package-without-using-version`). `unrar` está en
/// `non-free`, así que va como recomendado: con `depends` el paquete no se podría
/// instalar en un sistema que sólo tenga `main`, y sin él lo único que se pierde
/// es abrir los `.rar`.
const ARCHIVE_TOOLS: &[(&str, &str, Declared)] = &[
    ("zip", "zip", Declared::Depends),
    ("unzip", "unzip", Declared::Depends),
    ("tar", "tar", Declared::Essential),
    ("gunzip", "gzip", Declared::Essential),
    ("bunzip2", "bzip2", Declared::Depends),
    ("unxz", "xz-utils", Declared::Depends),
    // En trixie `7z` lo trae `7zip`; `p7zip-full` quedó como paquete de
    // transición que sólo depende de él.
    ("7z", "7zip", Declared::Depends),
    ("unrar", "unrar", Declared::Recommends),
];

#[derive(Debug, PartialEq)]
enum Declared {
    Depends,
    Recommends,
    Essential,
}

/// Los programas que `compress.rs` y `extract.rs` lanzan: los de
/// `Command::new("…")` y los de `program: "…"` de la tabla de formatos.
fn archive_programs() -> std::collections::BTreeSet<String> {
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut programs = std::collections::BTreeSet::new();
    for file in ["compress.rs", "extract.rs"] {
        let path = src.join(file);
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", path.display()));
        programs.extend(programs_in(&text));
    }
    programs
}

/// Los literales que siguen a `Command::new("` o a `program: "` en `text`.
fn programs_in(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    for marker in ["Command::new(\"", "program: \""] {
        let mut rest = text;
        while let Some(start) = rest.find(marker) {
            rest = &rest[start + marker.len()..];
            if let Some(end) = rest.find('"') {
                found.push(rest[..end].to_string());
                rest = &rest[end..];
            }
        }
    }
    found
}

#[test]
fn la_busqueda_de_programas_encuentra_los_literales() {
    // El control de la prueba de abajo: si `programs_in` no encontrara nada,
    // aquella pasaría sin haber mirado el código.
    let text = r#"
        let output = Command::new("unzip").arg("-o");
        FormatSpec { program: "zip", leading_args: &["-r"] }
        let mut command = Command::new(spec.program);
    "#;
    assert_eq!(programs_in(text), vec!["unzip", "zip"]);
    assert!(archive_programs().len() >= 6);
}

#[test]
fn cada_compresor_que_se_lanza_tiene_su_paquete() {
    // Un formato nuevo que llame a otro programa tiene que pasar por la tabla:
    // si no, el .deb se instala sin él y comprimir falla con «not installed».
    for program in archive_programs() {
        assert!(
            ARCHIVE_TOOLS.iter().any(|(p, _, _)| *p == program),
            "se lanza «{program}» y ARCHIVE_TOOLS no dice de qué paquete sale"
        );
    }
}

#[test]
fn los_compresores_estan_declarados_donde_corresponde() {
    let depends = deb_depends();
    let recommends = deb_recommends();
    for (program, package, declared) in ARCHIVE_TOOLS {
        let in_depends = depends.iter().any(|n| n == package);
        let in_recommends = recommends.iter().any(|n| n == package);
        match declared {
            Declared::Depends => assert!(
                in_depends && !in_recommends,
                "{package} (para «{program}») va en depends"
            ),
            Declared::Recommends => assert!(
                in_recommends && !in_depends,
                "{package} (para «{program}») va en recommends y no en depends"
            ),
            Declared::Essential => assert!(
                !in_depends && !in_recommends,
                "{package} es Essential en Debian: no se declara"
            ),
        }
    }
}

#[test]
fn unrar_es_recomendado_y_no_obligatorio() {
    // `unrar` está en non-free. Como `depends`, el paquete dejaría de poder
    // instalarse en un sistema sólo con `main`; decisión en #100.
    assert!(deb_recommends().iter().any(|n| n == "unrar"));
    assert!(!deb_depends()
        .iter()
        .any(|n| n == "unrar" || n == "unrar-free"));
}

#[test]
fn los_recomendados_tienen_nombre_de_debian_y_no_repiten_depends() {
    let depends = deb_depends();
    for name in deb_recommends() {
        assert!(
            is_debian_name(&name),
            "«{name}» no es un nombre de paquete de Debian"
        );
        assert!(
            !depends.contains(&name),
            "«{name}» está en depends y en recommends"
        );
    }
}
