/**
 * Cuándo se puede reindexar el disco sin molestar a nadie.
 *
 * Vive aparte del store para poder probarlo, y porque acá estaba el error más
 * caro de la búsqueda global: la inactividad se medía escuchando `mousemove` y
 * `keydown` sobre la propia ventana. Esos eventos sólo llegan cuando la ventana
 * tiene el foco, así que un gestor de archivos tapado —o sea, casi siempre—
 * concluía al minuto que no había nadie y lanzaba un recorrido completo del
 * sistema de archivos mientras la persona trabajaba en otra aplicación.
 *
 * Ahora la señal la da el compositor por `ext-idle-notify-v1`, que es quien
 * recibe la entrada de verdad. Ver `idle_monitor` en el backend.
 */

/** Lo que informa el backend, tal como viaja por IPC. */
export interface EstadoDeInactividadDelSistema {
	/** Si hay señal del sistema de la que fiarse. */
	available: boolean;
	is_idle: boolean;
	idle_for_ms: number;
	threshold_ms: number;
}

/**
 * Las tres respuestas posibles, y la tercera es la que importa.
 *
 * `desconocida` no es «hay alguien»: es que no hay de dónde saberlo —el
 * compositor no expone el protocolo, o se cortó la conexión—. Se distingue
 * porque las dos llevan a no reindexar, pero por motivos distintos, y confundir
 * «no sé» con «está activa» fue exactamente el error anterior al revés.
 */
export type SenalDeInactividad = 'inactiva' | 'activa' | 'desconocida';

/**
 * Cada cuánto se revisa de nuevo mientras la sesión sigue inactiva.
 *
 * El compositor avisa las transiciones, no el paso del tiempo: manda un aviso
 * al quedar la sesión sin nadie y otro al volver. Pero el índice puede vencerse
 * *durante* la inactividad —alguien se va a almorzar con el índice recién
 * hecho, y media hora después ya está viejo—, y ahí no hay ningún aviso nuevo
 * que escuchar. Cinco minutos: la ventana de reacción no importa cuando por
 * definición no hay nadie esperando, y el temporizador sólo existe mientras la
 * sesión está inactiva.
 */
export const RED_DE_SEGURIDAD_MS = 5 * 60 * 1000;

/** Traduce lo que contestó el backend, o su silencio. */
export function leerSenal(
	estado: EstadoDeInactividadDelSistema | null | undefined
): SenalDeInactividad {
	if (!estado?.available) return 'desconocida';
	return estado.is_idle ? 'inactiva' : 'activa';
}

/** Todo lo que hace falta saber antes de largar un escaneo automático. */
export interface CondicionesDeReindexado {
	senal: SenalDeInactividad;
	escaneoEnCurso: boolean;
	inicializado: boolean;
	indiceVencido: boolean;
}

/**
 * Si corresponde reindexar solo, sin que nadie lo haya pedido.
 *
 * Cuatro condiciones, y ninguna alcanza sola:
 *
 *  - **Ya hay un escaneo**: lanzar otro encima no adelanta nada.
 *  - **Sin inicializar**: no se sabe todavía qué tiene el índice.
 *  - **Índice al día**: rehacerlo es recorrer el disco para llegar a lo mismo.
 *  - **Sesión no inactiva**: acá entra `desconocida`, y entra como «no». Sin
 *    señal del sistema, la alternativa sería adivinar mirando la ventana, que
 *    es justamente lo que rompía esto. Un índice que se queda viejo hasta el
 *    próximo arranque es un peor buscador durante un rato; un escaneo del disco
 *    entero mientras alguien trabaja es una máquina que se arrastra.
 */
export function debeReindexar(condiciones: CondicionesDeReindexado): boolean {
	if (condiciones.escaneoEnCurso) return false;
	if (!condiciones.inicializado) return false;
	if (!condiciones.indiceVencido) return false;
	return condiciones.senal === 'inactiva';
}
