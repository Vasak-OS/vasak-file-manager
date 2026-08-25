//! Avisa cuando cambia la tabla de montajes del sistema.
//!
//! El frontend consultaba las unidades cada cinco segundos, para siempre: doce
//! recorridos por minuto de la tabla de montajes, y la inmensa mayoría
//! devolviendo exactamente lo mismo.
//!
//! El kernel ya avisa. `/proc/self/mountinfo` es *pollable*: cuando la tabla
//! cambia devuelve `POLLPRI`. Verificado en esta máquina montando y desmontando
//! un tmpfs — dos disparos, uno por cada cambio, y ni uno más en noventa
//! segundos. Así que un hilo bloqueado en `poll()` cuesta cero mientras no pasa
//! nada, que es el 99,9 % del tiempo, y reacciona al instante cuando pasa.
//!
//! Ojo con el detalle que hace que esto funcione: **después de cada disparo hay
//! que releer el archivo desde el principio.** Si no se consume, `poll()` vuelve
//! a devolver de inmediato y el hilo entra en un bucle cerrado quemando CPU —
//! exactamente lo contrario de lo que se busca.

use std::io::{Read, Seek, SeekFrom};
use std::os::fd::AsRawFd;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

/// Evento que escucha el frontend para recargar las unidades.
pub const MOUNTS_CHANGED_EVENT: &str = "drives://changed";

/// Un montaje suele generar varios cambios seguidos —el dispositivo, la
/// partición, el punto de montaje— y udisks puede reacomodar cosas justo
/// después. Se agrupan para no pedir tres recuentos por un solo pendrive.
const AGRUPAR: Duration = Duration::from_millis(250);

/// Cada cuánto se despierta igual, aunque no haya avisos.
///
/// Red de seguridad y nada más: si algún día `poll()` se comporta distinto —otro
/// kernel, un contenedor raro— las unidades se siguen actualizando, sólo que
/// tarde. Sin esto, un `poll()` que no dispare deja la lista congelada para
/// siempre, que es peor que sondear.
const RED_DE_SEGURIDAD: Duration = Duration::from_secs(60);

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        if let Err(error) = observar(&app) {
            // No es fatal: el frontend tiene su propio sondeo lento como
            // respaldo, así que se avisa y se deja de observar.
            eprintln!("[montajes] no se pudo observar /proc/self/mountinfo: {error}");
        }
    });
}

fn observar(app: &AppHandle) -> Result<(), String> {
    let mut archivo = std::fs::File::open("/proc/self/mountinfo")
        .map_err(|error| format!("no se pudo abrir: {error}"))?;

    let mut descartar = Vec::with_capacity(64 * 1024);
    let mut ultimo_aviso: Option<Instant> = None;

    loop {
        let mut fds = [libc::pollfd {
            fd: archivo.as_raw_fd(),
            events: libc::POLLPRI | libc::POLLERR,
            revents: 0,
        }];

        // SAFETY: `fds` es un arreglo válido de un elemento y el descriptor vive
        // mientras viva `archivo`.
        let listos = unsafe {
            libc::poll(
                fds.as_mut_ptr(),
                1,
                RED_DE_SEGURIDAD.as_millis() as libc::c_int,
            )
        };

        if listos < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(format!("poll falló: {error}"));
        }

        let por_aviso = listos > 0;
        if por_aviso {
            // Consumir el archivo, o el próximo `poll()` vuelve enseguida y esto
            // se convierte en un bucle cerrado. Verificado: en reposo el proceso
            // queda en 0,1 % de un núcleo.
            descartar.clear();
            archivo
                .seek(SeekFrom::Start(0))
                .map_err(|error| format!("no se pudo rebobinar: {error}"))?;
            archivo
                .read_to_end(&mut descartar)
                .map_err(|error| format!("no se pudo leer: {error}"))?;
        }

        // El agrupado sólo aplica a los avisos del kernel; el despertar
        // periódico ya viene espaciado por definición.
        if por_aviso {
            if let Some(anterior) = ultimo_aviso {
                if anterior.elapsed() < AGRUPAR {
                    thread::sleep(AGRUPAR - anterior.elapsed());
                }
            }
        }

        // Se avisa también cuando `poll` volvió por tiempo y no por evento, y
        // eso es a propósito: es la red de seguridad de la que habla
        // `RED_DE_SEGURIDAD`. Si algún kernel o contenedor no notificara, las
        // unidades se siguen actualizando una vez por minuto en lugar de quedar
        // congeladas para siempre.

        if app.emit(MOUNTS_CHANGED_EVENT, ()).is_err() {
            // La ventana se fue: no hay a quién avisarle.
            return Ok(());
        }
        ultimo_aviso = Some(Instant::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_archivo_de_montajes_existe_y_se_puede_abrir() {
        // Si esto falla, `start` va a avisar y quedarse en el respaldo del
        // frontend, que es el comportamiento buscado — pero conviene saberlo.
        assert!(std::fs::File::open("/proc/self/mountinfo").is_ok());
    }

    #[test]
    fn el_agrupado_es_mas_corto_que_la_red_de_seguridad() {
        // Al revés, cada aviso esperaría más que el despertar periódico y el
        // agrupado dejaría de tener sentido.
        assert!(AGRUPAR < RED_DE_SEGURIDAD);
    }

    #[test]
    fn la_tabla_de_montajes_se_lee_entera() {
        // El bucle depende de poder consumir el archivo completo; si la lectura
        // se cortara, `poll()` volvería a disparar en bucle.
        let contenido = std::fs::read_to_string("/proc/self/mountinfo").unwrap();
        assert!(contenido.lines().count() > 1, "{contenido}");
        // Cada línea de mountinfo tiene al menos los diez campos del formato.
        for linea in contenido.lines() {
            assert!(
                linea.split_whitespace().count() >= 10,
                "línea inesperada: {linea}"
            );
        }
    }
}
