/**
 * Cuándo hay que seguir preguntando por el estado de la búsqueda global.
 *
 * Vive aparte del store para poder probarlo, y porque acá estaba un sondeo que
 * no se apagaba nunca: `pollStatus` se reagenda a sí mismo, y lo único que lo
 * detenía era cerrar el panel de búsqueda —y sólo si en ese instante no había un
 * escaneo en curso—. Como el escaneo arranca solo al abrir el gestor, sin que
 * nadie toque el panel, el caso normal era que nadie lo detuviera: un IPC cada
 * cinco segundos durante toda la vida de la aplicación, preguntando por un
 * escaneo que había terminado hace horas.
 */

/** Cada cuánto se pregunta mientras el escaneo avanza. */
export const SONDEO_ACTIVO_MS = 300;
/** Y cada cuánto cuando no avanza nada pero hay alguien mirando el panel. */
export const SONDEO_EN_REPOSO_MS = 5000;

/**
 * Si el sondeo tiene que seguir vivo.
 *
 * Tres casos distintos, y la diferencia entre los dos últimos es la que faltaba:
 *
 *  - **Escaneo o commit en curso**: se sigue aunque nadie mire. Es trabajo real
 *    que termina, y al terminar hay que enterarse para dejar de preguntar.
 *  - **Panel abierto y a la vista**: se sigue, porque hay a quién informarle.
 *  - **Panel cerrado, o ventana tapada**: no hay nada que mirar ni nadie
 *    mirando. Acá es donde el sondeo se quedaba corriendo para siempre.
 */
export function debeSeguirSondeando(
	activo: boolean,
	panelAbierto: boolean,
	oculto: boolean
): boolean {
	if (activo) return true;
	return panelAbierto && !oculto;
}

/**
 * Cuánto esperar hasta la próxima pregunta.
 *
 * Tres décimas mientras el escaneo avanza —el progreso tiene que verse moverse—
 * y cinco segundos cuando no hay nada avanzando.
 */
export function intervaloDeSondeo(activo: boolean): number {
	return activo ? SONDEO_ACTIVO_MS : SONDEO_EN_REPOSO_MS;
}
