/**
 * Cómo terminó el último escaneo, y qué se dice al respecto.
 *
 * Vive aparte del store porque la decisión es pura —depende de tres valores y
 * de nada más— y así se puede probar sin montar nada, igual que el sondeo.
 */

/**
 * Los cuatro estados que el backend puede escribir.
 *
 * Son cadenas y no un tipo cerrado a propósito: el archivo que los trae lo
 * comparten dos programas que se actualizan por separado —el gestor lo escribe,
 * `vasak-prism` lo lee— y un valor que no conocemos tiene que poder llegar sin
 * romper nada.
 */
export const ESTADO_EN_CURSO = 'in_progress';
export const ESTADO_COMPLETO = 'complete';
export const ESTADO_CANCELADO = 'cancelled';
export const ESTADO_FALLADO = 'failed';

/**
 * Si lo indexado puede estar incompleto, y conviene decirlo.
 *
 * Sin esto, «0 elementos indexados» se lee como un hecho —no hay archivos—
 * cuando puede ser un síntoma: el escaneo se canceló, falló, o murió a mitad.
 * Tres situaciones distintas que hoy se ven iguales.
 *
 * La regla para los valores raros es asimétrica, y viene del contrato:
 *
 * - **Falta el estado** → lo escribió una versión anterior, que no tenía cómo
 *   avisar. Se trata como completo, que es como se venía tratando. Si no, cada
 *   instalación sin actualizar mostraría un aviso permanente por algo que
 *   siempre fue así.
 * - **Un valor que no conocemos** → lo escribió una versión más nueva, que sabe
 *   algo que nosotros no. Ahí se avisa, porque no podemos afirmar que esté
 *   completo.
 *
 * Leída de golpe es al revés de lo que uno esperaría —la ausencia manda confiar
 * y lo desconocido manda desconfiar—, así que va el motivo y no sólo la regla:
 * sin él alguien la «arregla» y las dos ramas terminan haciendo lo mismo.
 *
 * @param estado Lo que dice el archivo, o `null` si no lo dice.
 * @param sigueVivo Si un «en curso» todavía vale. Lo decide el backend, con el
 *   vencimiento que declaró el que escribió: un escaneo que muere de golpe deja
 *   el «en curso» puesto para siempre.
 * @param escaneando Si hay uno corriendo ahora mismo en esta ventana, que es el
 *   caso donde ya se está mostrando el progreso y no hace falta avisar nada.
 */
export function indiceEstaIncompleto(
	estado: string | null,
	sigueVivo: boolean,
	escaneando: boolean
): boolean {
	if (escaneando) return false;
	if (estado === null) return false;

	switch (estado) {
		case ESTADO_COMPLETO:
			return false;
		case ESTADO_CANCELADO:
		case ESTADO_FALLADO:
			return true;
		case ESTADO_EN_CURSO:
			// Uno que todavía vale es un escaneo de hace un momento; uno vencido
			// es uno que murió sin llegar a decir cómo terminó.
			return !sigueVivo;
		default:
			return true;
	}
}
