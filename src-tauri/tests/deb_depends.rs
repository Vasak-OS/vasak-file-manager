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
//! compresores de `compress.rs` y `extract.rs`, y los de las miniaturas, el
//! montaje y «abrir con» (#105). Ésos no aparecen en `readelf`, así que se sacan
//! del código mismo y se cruzan con `ARCHIVE_TOOLS` y `SPAWNED_TOOLS`.

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
    /// Sólo se lanza si falló el programa nombrado, que sí va en `depends`: no
    /// se declara, porque sin él no se pierde nada.
    Fallback(&'static str),
}

/// Los programas que `compress.rs` y `extract.rs` lanzan: los de
/// `Command::new("…")` y los de `program: "…"` de la tabla de formatos.
fn archive_programs() -> std::collections::BTreeSet<String> {
    programs_in_files(&["compress.rs", "extract.rs"])
}

fn source_of(file: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join(file);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", path.display()))
}

fn programs_in_files(files: &[&str]) -> std::collections::BTreeSet<String> {
    files
        .iter()
        .flat_map(|file| programs_in(&source_of(file)))
        .collect()
}

/// Los archivos que lanzan los programas de `SPAWNED_TOOLS`.
const SPAWNING_FILES: &[&str] = &[
    "video_thumbnail.rs",
    "read_file.rs",
    "dir_reader.rs",
    "open_with/linux.rs",
    "open_with/mod.rs",
];

/// Los programas externos de las miniaturas, el montaje y «abrir con», con el
/// paquete de Debian que los trae y cómo se declara.
///
/// Los cuatro opcionales —ffmpeg, poppler-utils, sshfs y fuse3— son decisión de
/// #105: `ffmpeg` y `poppler` son pesados y sólo dan miniaturas, y `sshfs` y
/// `fuse3` sólo le sirven a quien monta por SSH. Sin las miniaturas la vista se
/// queda con el icono del tipo, callada a propósito; sin `sshfs`, montar por
/// SSH contesta `missingPackage` con el nombre del paquete. `gio`, en cambio,
/// es el primer camino de «abrir con» y del montaje por SMB, así que va en
/// `depends`.
///
/// `util-linux` es `Essential: yes` en Debian. `mount` no lo es —es `Priority:
/// required` desde que se separó—, así que se declara aunque esté en toda
/// instalación.
const SPAWNED_TOOLS: &[(&str, &str, Declared)] = &[
    ("ffmpeg", "ffmpeg", Declared::Recommends),
    ("ffprobe", "ffmpeg", Declared::Recommends),
    ("pdftoppm", "poppler-utils", Declared::Recommends),
    ("sshfs", "sshfs", Declared::Recommends),
    // En trixie `fuse3` trae `fusermount3` y `fusermount` como enlace; en Arch
    // sólo el primero, por eso el código prueba ése antes.
    ("fusermount3", "fuse3", Declared::Recommends),
    ("fusermount", "fuse3", Declared::Recommends),
    ("gio", "libglib2.0-bin", Declared::Depends),
    ("udisksctl", "udisks2", Declared::Depends),
    ("lsblk", "util-linux", Declared::Essential),
    ("mount", "mount", Declared::Depends),
    ("umount", "mount", Declared::Depends),
    ("xdg-open", "xdg-utils", Declared::Depends),
    ("xdg-mime", "xdg-utils", Declared::Depends),
    ("gtk-launch", "libgtk-3-bin", Declared::Fallback("gio")),
    ("file", "file", Declared::Fallback("gio")),
];

/// Lo que lanzan los archivos de `SPAWNING_FILES`, más los desmontadores de
/// FUSE, que se lanzan desde una lista (`FUSE_UNMOUNTERS`) y no con un literal.
fn spawned_programs() -> std::collections::BTreeSet<String> {
    let mut programs = programs_in_files(SPAWNING_FILES);
    programs.extend(list_after(
        &source_of("dir_reader.rs"),
        "const FUSE_UNMOUNTERS",
    ));
    programs
}

/// Los literales de la lista `[…]` que sigue a `marker` en `text`.
fn list_after(text: &str, marker: &str) -> Vec<String> {
    let Some(start) = text.find(marker) else {
        return Vec::new();
    };
    let rest = &text[start..];
    let Some(open) = rest.find("= [") else {
        return Vec::new();
    };
    let rest = &rest[open + 3..];
    let end = rest.find(']').unwrap_or(rest.len());
    rest[..end]
        .split(',')
        .filter_map(|item| {
            let item = item.trim();
            item.strip_prefix('"')
                .and_then(|item| item.strip_suffix('"'))
                .map(str::to_string)
        })
        .collect()
}

/// Que cada programa de `tools` esté en la lista del `.deb` que le toca.
fn assert_declared(tools: &[(&str, &str, Declared)]) {
    let depends = deb_depends();
    let recommends = deb_recommends();
    for (program, package, declared) in tools {
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
            Declared::Fallback(primary) => {
                assert!(
                    !in_depends && !in_recommends,
                    "«{program}» es respaldo de «{primary}»: {package} no se declara"
                );
                assert!(
                    tools
                        .iter()
                        .any(|(p, _, d)| p == primary && *d == Declared::Depends),
                    "«{program}» es respaldo de «{primary}», que tiene que ir en depends"
                );
            }
        }
    }
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
    assert_declared(ARCHIVE_TOOLS);
}

#[test]
fn la_lista_de_desmontadores_se_lee_del_codigo() {
    // El control de las pruebas de abajo: sin él, un cambio de forma de
    // `FUSE_UNMOUNTERS` las dejaría pasando sin mirar esa lista.
    let text = r#"const FUSE_UNMOUNTERS: [&str; 2] = ["fusermount3", "fusermount"];"#;
    assert_eq!(
        list_after(text, "const FUSE_UNMOUNTERS"),
        vec!["fusermount3", "fusermount"]
    );
    let programs = spawned_programs();
    for program in [
        "ffmpeg",
        "ffprobe",
        "pdftoppm",
        "sshfs",
        "fusermount3",
        "gio",
    ] {
        assert!(
            programs.contains(program),
            "el código ya no lanza «{program}»: sacarlo de SPAWNED_TOOLS y de las recetas"
        );
    }
}

#[test]
fn cada_programa_que_se_lanza_tiene_su_paquete() {
    // Un programa nuevo en las miniaturas, el montaje o «abrir con» tiene que
    // pasar por la tabla: si no, el .deb se instala sin él y nadie se entera.
    for program in spawned_programs() {
        assert!(
            SPAWNED_TOOLS.iter().any(|(p, _, _)| *p == program),
            "se lanza «{program}» y SPAWNED_TOOLS no dice de qué paquete sale"
        );
    }
}

#[test]
fn cada_programa_de_la_tabla_se_sigue_lanzando() {
    // La otra dirección: una fila que el código ya no usa deja declarado un
    // paquete que no hace falta.
    let programs = spawned_programs();
    for (program, _, _) in SPAWNED_TOOLS {
        assert!(
            programs.contains(*program),
            "SPAWNED_TOOLS nombra «{program}» y el código ya no lo lanza"
        );
    }
}

#[test]
fn los_programas_que_se_lanzan_estan_declarados_donde_corresponde() {
    assert_declared(SPAWNED_TOOLS);
}

#[test]
fn las_miniaturas_y_el_montaje_por_ssh_son_opcionales() {
    // Decisión de #105: son pesados o de nicho, y sin ellos el gestor anda.
    let depends = deb_depends();
    let recommends = deb_recommends();
    for package in ["ffmpeg", "poppler-utils", "sshfs", "fuse3"] {
        assert!(
            recommends.iter().any(|n| n == package),
            "{package} va en recommends"
        );
        assert!(
            !depends.iter().any(|n| n == package),
            "{package} no va en depends"
        );
    }
    assert!(
        depends.iter().any(|n| n == "libglib2.0-bin"),
        "gio va en depends"
    );
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
