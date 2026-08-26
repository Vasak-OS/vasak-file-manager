//! Si la sesión está inactiva. Lo sabe el compositor, no la ventana.
//!
//! La búsqueda global reindexa el disco entero cuando nadie está usando la
//! máquina. Para saber si nadie la está usando, el frontend escuchaba
//! `mousemove`, `keydown` y compañía sobre su propia ventana — y esos eventos
//! sólo llegan cuando la ventana tiene el foco. Tapada o minimizada, que es lo
//! normal para un gestor de archivos, no llega ninguno: al minuto la ventana
//! concluía que no había nadie y arrancaba un recorrido completo del sistema de
//! archivos, justo mientras la persona trabajaba en otra aplicación.
//!
//! La pregunta no es «¿hace cuánto que nadie toca *esta ventana*?» sino «¿hace
//! cuánto que nadie toca *la máquina*?», y eso sólo lo sabe quien recibe la
//! entrada de verdad. En Wayland eso se pregunta con `ext-idle-notify-v1`, que
//! es el mismo protocolo que usa swayidle para bloquear la pantalla: se declara
//! un umbral y el compositor avisa cuando se cruza (`idled`) y cuando vuelve a
//! haber actividad (`resumed`). Dos eventos por período de inactividad, sin
//! sondeo y sin que importe qué ventana tiene el foco.
//!
//! Se pide `get_idle_notification` y no `get_input_idle_notification` a
//! propósito: la primera respeta los inhibidores de inactividad, así que
//! mientras un reproductor declare que hay algo que mirar, la sesión no se
//! considera inactiva. Un video a pantalla completa no tiene entrada durante
//! dos horas y no es momento de ponerse a recorrer el disco.
//!
//! El estado se expone además como comando (`system_idle_state`), porque no es
//! una pregunta del gestor de archivos: cualquier aplicación del escritorio que
//! quiera esperar a que no molesta necesita exactamente esto.

use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use wayland_client::protocol::{wl_registry, wl_seat};
use wayland_client::{Connection, Dispatch, QueueHandle, delegate_noop};
use wayland_protocols::ext::idle_notify::v1::client::{
    ext_idle_notification_v1::{self, ExtIdleNotificationV1},
    ext_idle_notifier_v1::ExtIdleNotifierV1,
};

/// Evento que escucha el frontend cuando la sesión entra o sale de inactividad.
pub const IDLE_CHANGED_EVENT: &str = "idle://changed";

/// Cuánto silencio hace falta para dar la sesión por inactiva.
///
/// Un minuto: lo suficiente para que levantarse a buscar un café no cuente como
/// «se fue», y lo bastante poco como para aprovechar una pausa real. El umbral
/// lo aplica el compositor, así que este número no se duplica en el frontend —
/// viaja en el estado como `threshold_ms`.
const UMBRAL: Duration = Duration::from_secs(60);

/// Lo que el frontend recibe, tanto por el comando como por el evento.
///
/// En `snake_case` como el resto de las respuestas del backend.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct EstadoInactividad {
    /// Si hay una señal del sistema de la que fiarse.
    ///
    /// Falso mientras el hilo no logró conectarse, y falso para siempre si el
    /// compositor no expone el protocolo. **No es lo mismo que «hay alguien»**:
    /// es «no sé», y quien lo consuma tiene que tratarlo como tal en vez de
    /// asumir que la sesión está activa o que está libre.
    pub available: bool,
    /// Si la sesión lleva más de `threshold_ms` sin actividad.
    pub is_idle: bool,
    /// Hace cuánto que no hay actividad, contado desde que dejó de haberla.
    ///
    /// Incluye el umbral: cuando el compositor avisa, la persona ya estuvo
    /// `threshold_ms` sin tocar nada, así que el primer valor informado es el
    /// umbral y no cero. Cero cuando la sesión está activa o no se sabe.
    pub idle_for_ms: u64,
    /// El umbral con el que se pidió el aviso.
    pub threshold_ms: u64,
}

/// El estado que comparten el hilo de Wayland y el comando.
///
/// Aparte del hilo para poder probarlo: las transiciones son tres líneas, pero
/// son las tres que deciden si se lanza un escaneo del disco entero.
#[derive(Debug, Default)]
struct Estado {
    disponible: bool,
    /// Cuándo llegó el `idled`, no cuándo dejó de haber actividad: eso fue un
    /// umbral antes.
    inactivo_desde: Option<Instant>,
}

impl Estado {
    fn marcar_disponible(&mut self) {
        self.disponible = true;
    }

    /// El compositor cortó la señal —se cayó la conexión, o nunca la hubo—.
    ///
    /// Se olvida también la inactividad: informar «inactivo» con una señal que
    /// dejó de actualizarse es peor que informar «no sé», porque nadie se va a
    /// enterar de que la persona volvió.
    fn marcar_sin_senal(&mut self) {
        self.disponible = false;
        self.inactivo_desde = None;
    }

    fn marcar_inactivo(&mut self, cuando: Instant) {
        self.inactivo_desde = Some(cuando);
    }

    fn marcar_activo(&mut self) {
        self.inactivo_desde = None;
    }

    fn instantanea(&self, ahora: Instant) -> EstadoInactividad {
        let inactivo_desde = self.inactivo_desde.filter(|_| self.disponible);

        EstadoInactividad {
            available: self.disponible,
            is_idle: inactivo_desde.is_some(),
            idle_for_ms: inactivo_desde
                .map(|desde| UMBRAL.as_millis() as u64 + ahora.duration_since(desde).as_millis() as u64)
                .unwrap_or(0),
            threshold_ms: UMBRAL.as_millis() as u64,
        }
    }
}

fn estado() -> &'static Mutex<Estado> {
    static ESTADO: OnceLock<Mutex<Estado>> = OnceLock::new();
    ESTADO.get_or_init(|| Mutex::new(Estado::default()))
}

/// Lee el estado sin dejar que un cerrojo envenenado tumbe a quien pregunta.
///
/// Si un hilo paniqueó con el cerrojo tomado, el estado que quedó adentro es
/// igual de válido —son tres campos que se escriben de a uno—, y negarse a
/// responder convertiría ese panic en un gestor de archivos que no puede
/// contestar más.
fn con_estado<T>(accion: impl FnOnce(&mut Estado) -> T) -> T {
    let mut guardia = match estado().lock() {
        Ok(guardia) => guardia,
        Err(envenenado) => envenenado.into_inner(),
    };
    accion(&mut guardia)
}

/// Qué informa el sistema sobre la inactividad de la sesión.
#[tauri::command]
pub fn system_idle_state() -> EstadoInactividad {
    let ahora = Instant::now();
    con_estado(|estado| estado.instantanea(ahora))
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        if let Err(error) = observar(&app) {
            // No es fatal: sin señal del sistema, el frontend deja de reindexar
            // solo. Prefiere no hacer nada antes que ponerse a recorrer el
            // disco adivinando.
            eprintln!("[inactividad] sin señal del compositor: {error}");
        }
        con_estado(|estado| estado.marcar_sin_senal());
        avisar(&app);
    });
}

fn avisar(app: &AppHandle) {
    let instantanea = system_idle_state();
    let _ = app.emit(IDLE_CHANGED_EVENT, instantanea);
}

/// Lo que el hilo va juntando mientras el compositor le contesta.
struct Cliente {
    app: AppHandle,
    notificador: Option<ExtIdleNotifierV1>,
    asiento: Option<wl_seat::WlSeat>,
}

fn observar(app: &AppHandle) -> Result<(), String> {
    let conexion = Connection::connect_to_env()
        .map_err(|error| format!("no se pudo conectar a Wayland: {error}"))?;

    let mut cola = conexion.new_event_queue();
    let manija = cola.handle();
    conexion.display().get_registry(&manija, ());

    let mut cliente = Cliente {
        app: app.clone(),
        notificador: None,
        asiento: None,
    };

    // Una vuelta para que el registro conteste con los globales, y otra para
    // recibir lo que hayan generado los `bind` de la primera.
    cola.roundtrip(&mut cliente)
        .map_err(|error| format!("no contestó el registro: {error}"))?;
    cola.roundtrip(&mut cliente)
        .map_err(|error| format!("no contestó el registro: {error}"))?;

    let notificador = cliente
        .notificador
        .clone()
        .ok_or("el compositor no expone ext_idle_notifier_v1")?;
    let asiento = cliente
        .asiento
        .clone()
        .ok_or("el compositor no expone ningún wl_seat")?;

    // Vive hasta que muera el hilo: soltarlo cancelaría el aviso.
    let _notificacion =
        notificador.get_idle_notification(UMBRAL.as_millis() as u32, &asiento, &manija, ());

    // Recién acá hay señal de la que fiarse. Antes de esto el estado dice «no
    // sé», que es la verdad.
    con_estado(|estado| estado.marcar_disponible());
    avisar(app);

    loop {
        cola.blocking_dispatch(&mut cliente)
            .map_err(|error| format!("se cortó la conexión: {error}"))?;
    }
}

impl Dispatch<wl_registry::WlRegistry, ()> for Cliente {
    fn event(
        cliente: &mut Self,
        registro: &wl_registry::WlRegistry,
        evento: wl_registry::Event,
        _datos: &(),
        _conexion: &Connection,
        manija: &QueueHandle<Self>,
    ) {
        let wl_registry::Event::Global {
            name,
            interface,
            version,
        } = evento
        else {
            return;
        };

        match interface.as_str() {
            "ext_idle_notifier_v1" if cliente.notificador.is_none() => {
                cliente.notificador = Some(registro.bind(name, version.min(1), manija, ()));
            }
            // Alcanza con la versión 1: del asiento sólo se necesita el objeto,
            // para decirle al compositor de quién es la entrada que hay que
            // mirar. Pedir más versión sería pedir eventos que no se usan.
            "wl_seat" if cliente.asiento.is_none() => {
                cliente.asiento = Some(registro.bind(name, version.min(1), manija, ()));
            }
            _ => {}
        }
    }
}

impl Dispatch<ExtIdleNotificationV1, ()> for Cliente {
    fn event(
        cliente: &mut Self,
        _notificacion: &ExtIdleNotificationV1,
        evento: ext_idle_notification_v1::Event,
        _datos: &(),
        _conexion: &Connection,
        _manija: &QueueHandle<Self>,
    ) {
        match evento {
            ext_idle_notification_v1::Event::Idled => {
                con_estado(|estado| estado.marcar_inactivo(Instant::now()));
            }
            ext_idle_notification_v1::Event::Resumed => {
                con_estado(|estado| estado.marcar_activo());
            }
            // El protocolo puede crecer; un evento que no conocemos no cambia
            // nada y no tiene por qué generar un aviso.
            _ => return,
        }

        avisar(&cliente.app);
    }
}

delegate_noop!(Cliente: ignore ExtIdleNotifierV1);
delegate_noop!(Cliente: ignore wl_seat::WlSeat);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sin_senal_no_se_afirma_que_haya_alguien() {
        // La distinción que motiva todo esto: «no sé» tiene que verse distinto
        // de «hay alguien usando la máquina». Si se informara `is_idle: false`
        // con `available: true`, el frontend no tendría cómo darse cuenta de
        // que la señal no existe.
        let estado = Estado::default();
        let instantanea = estado.instantanea(Instant::now());

        assert!(!instantanea.available);
        assert!(!instantanea.is_idle);
        assert_eq!(instantanea.idle_for_ms, 0);
    }

    #[test]
    fn con_senal_y_sin_aviso_la_sesion_esta_activa() {
        let mut estado = Estado::default();
        estado.marcar_disponible();

        let instantanea = estado.instantanea(Instant::now());

        assert!(instantanea.available);
        assert!(!instantanea.is_idle);
        assert_eq!(instantanea.idle_for_ms, 0);
    }

    #[test]
    fn la_inactividad_se_cuenta_desde_que_dejo_de_haber_actividad() {
        // El compositor avisa una vez cruzado el umbral, así que en el instante
        // del aviso ya hubo un minuto sin nadie. Informar cero ahí haría que
        // cualquier regla del tipo «esperá a que lleve un rato» nunca se
        // cumpliera, o se cumpliera un umbral tarde.
        let mut estado = Estado::default();
        estado.marcar_disponible();

        let cuando = Instant::now();
        estado.marcar_inactivo(cuando);

        let instantanea = estado.instantanea(cuando + Duration::from_secs(5));

        assert!(instantanea.is_idle);
        assert_eq!(instantanea.idle_for_ms, UMBRAL.as_millis() as u64 + 5_000);
        assert_eq!(instantanea.threshold_ms, UMBRAL.as_millis() as u64);
    }

    #[test]
    fn volver_a_haber_actividad_apaga_la_inactividad() {
        let mut estado = Estado::default();
        estado.marcar_disponible();
        estado.marcar_inactivo(Instant::now());
        estado.marcar_activo();

        let instantanea = estado.instantanea(Instant::now());

        assert!(instantanea.available);
        assert!(!instantanea.is_idle);
        assert_eq!(instantanea.idle_for_ms, 0);
    }

    #[test]
    fn perder_la_senal_no_deja_la_sesion_inactiva_para_siempre() {
        // Si se cae la conexión con el compositor mientras la sesión estaba
        // inactiva, nadie va a avisar que la persona volvió. Sostener el
        // «inactivo» sería sostener un permiso para escanear el disco que ya no
        // tiene quién lo revoque.
        let mut estado = Estado::default();
        estado.marcar_disponible();
        estado.marcar_inactivo(Instant::now());

        estado.marcar_sin_senal();
        let instantanea = estado.instantanea(Instant::now());

        assert!(!instantanea.available);
        assert!(!instantanea.is_idle);
    }

    #[test]
    fn el_umbral_entra_en_un_u32() {
        // `get_idle_notification` recibe el umbral en milisegundos como `uint`,
        // y el `as u32` de más arriba lo truncaría en silencio.
        assert!(UMBRAL.as_millis() <= u32::MAX as u128);
    }
}
