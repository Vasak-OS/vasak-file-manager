//! Que los caminos calientes del backend sigan pidiendo una sola vez el tipo y
//! el tamaño de cada entrada.
//!
//! Los cuatro cambios que cuida este archivo (`read_entry`, `read_dir`,
//! `calculate_dir_size_no_timeout` y el `calculate_dir_size` de la búsqueda
//! global) **no cambian el resultado**: son la misma lista, el mismo orden y el
//! mismo total, con menos `stat` y menos asignaciones. Por eso una prueba de
//! comportamiento sola no los defiende —pasa igual con el código viejo— y hay
//! que mirar la forma del código, como ya se hace del lado de JS
//! (`tests/seleccion-sin-recorrer.test.ts`, `tests/nadie-resuelve-iconos-a-mano.test.ts`).
//!
//! Cada prueba lee el fuente con `include_str!` y afirma la propiedad que el
//! cambio introduce. Volver al patrón viejo —dos `stat` por entrada, una
//! minúscula por comparación, un archivo por vez— las pone en rojo.

/// El cuerpo de la función `fn <name>` de `source`, del `fn` hasta su llave de
/// cierre de nivel superior.
///
/// El cierre de una función de primer nivel es una `}` sola en la primera
/// columna; todo lo de adentro va indentado. Sin esto, una prueba pasaría
/// mirando el archivo entero en vez de la función que dice mirar.
fn function_body<'a>(source: &'a str, name: &str) -> &'a str {
    let marker = format!("fn {name}");
    let start = source
        .find(&marker)
        .unwrap_or_else(|| panic!("no se encontró «{marker}» en el fuente"));
    let rest = &source[start..];
    let end = rest.find("\n}").map(|pos| pos + 2).unwrap_or(rest.len());
    &rest[..end]
}

#[test]
fn el_recorte_del_cuerpo_encuentra_las_funciones() {
    // El control: si el recorte devolviera el archivo entero o vacío, las
    // pruebas de abajo pasarían sin haber mirado la función que nombran.
    let body = function_body(include_str!("../src/dir_reader.rs"), "read_entry");
    assert!(body.starts_with("fn read_entry"), "«{}»", body);
    assert!(
        body.contains("is_hidden"),
        "el cuerpo tiene que llegar hasta el final de la función"
    );
    assert!(
        !body.contains("fn read_dir"),
        "el cuerpo no puede tragarse la función siguiente"
    );
}

#[test]
fn read_entry_pide_symlink_metadata_antes_que_metadata() {
    // El caso común —un archivo, una carpeta— hace **un** `stat`: el
    // `symlink_metadata`, que no sigue el enlace. `metadata` es el segundo
    // `stat` y va sólo por la rama del symlink. Al revés —como estaba— cada
    // entrada pagaba los dos.
    let body = function_body(include_str!("../src/dir_reader.rs"), "read_entry");

    assert_eq!(
        body.matches("fs::symlink_metadata").count(),
        1,
        "una sola llamada a `symlink_metadata`"
    );
    assert_eq!(
        body.matches("fs::metadata").count(),
        1,
        "una sola llamada a `metadata`"
    );
    assert!(
        body.contains("if is_symlink"),
        "`metadata` tiene que estar guardada por la rama del symlink"
    );

    let first_symlink_metadata = body.find("fs::symlink_metadata").unwrap();
    let metadata = body.find("fs::metadata").unwrap();
    assert!(
        first_symlink_metadata < metadata,
        "`symlink_metadata` va primero: `metadata` es el segundo `stat` y sólo para enlaces"
    );
}

#[test]
fn read_dir_ordena_con_la_clave_cacheada_y_no_en_cada_comparacion() {
    // La clave —el nombre en minúsculas— se arma una vez por entrada con
    // `sort_by_cached_key`, no una vez por comparación con `to_lowercase()`
    // adentro del comparador. `sort_by_cached_key` es estable, así que el orden
    // es el de antes.
    let body = function_body(include_str!("../src/dir_reader.rs"), "read_dir");

    assert!(
        body.contains("sort_by_cached_key"),
        "el orden tiene que usar `sort_by_cached_key`"
    );
    assert!(
        !body.contains("sort_by("),
        "un comparador que calcula la minúscula en cada comparación vuelve a asignar O(n log n) veces"
    );
}

#[test]
fn el_tamano_sin_timeout_reparte_la_suma_entre_los_nucleos() {
    // El caso grande —el que llega sin timeout— recorría un archivo por vez. La
    // recorrida comprueba la cancelación y después la suma se reparte con
    // `par_iter`, igual que el camino con timeout.
    let body = function_body(
        include_str!("../src/dir_size.rs"),
        "calculate_dir_size_no_timeout",
    );

    assert!(
        body.contains("par_iter()"),
        "la suma tiene que repartirse entre los núcleos con `par_iter`"
    );
}

#[test]
fn el_tamano_de_la_busqueda_decide_por_file_type() {
    // El tipo sale del propio `readdir` (`file_type()`), así que no hace falta
    // un `stat` de más —`is_file()`/`is_dir()` sobre la ruta— para clasificar
    // cada entrada. Un enlace no es ninguna de las dos cosas para `file_type()`,
    // así que se resuelve aparte: por eso `is_symlink()`.
    let body = function_body(
        include_str!("../src/global_search.rs"),
        "calculate_dir_size",
    );

    assert!(
        body.contains("file_type.is_file()"),
        "la decisión tiene que salir de `file_type`"
    );
    assert!(
        body.contains("file_type.is_dir()"),
        "la decisión tiene que salir de `file_type`"
    );
    assert!(
        body.contains("is_symlink()"),
        "los enlaces se resuelven aparte, siguiendo el enlace para clasificarlo"
    );

    let symlink = body.find("is_symlink()").unwrap();
    let first_is_file = body.find(".is_file()").unwrap();
    assert!(
        symlink < first_is_file,
        "`is_file()`/`is_dir()` sobre la ruta quedan sólo en la rama del symlink"
    );
}
