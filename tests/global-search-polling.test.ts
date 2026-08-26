import { describe, expect, test } from 'bun:test';
import {
	debeRetomarSondeo,
	debeSeguirSondeando,
	intervaloDeSondeo,
	SONDEO_ACTIVO_MS,
	SONDEO_EN_REPOSO_MS,
} from '@/stores/runtime/global-search-polling';

describe('debeSeguirSondeando', () => {
	test('un escaneo en curso se sigue aunque nadie esté mirando', () => {
		// Es trabajo real que termina, y hay que enterarse de que terminó para
		// poder dejar de preguntar. Si acá se cortara, el sondeo no volvería a
		// arrancar y el estado quedaría congelado en «escaneando» para siempre.
		expect(debeSeguirSondeando(true, false, true)).toBe(true);
		expect(debeSeguirSondeando(true, true, true)).toBe(true);
	});

	test('sin escaneo y con el panel cerrado no se pregunta nada', () => {
		// El bug: esto devolvía «sí» siempre, y como el escaneo arranca solo al
		// abrir la aplicación —sin que nadie toque el panel— era el caso normal.
		// Un IPC cada cinco segundos durante toda la vida del gestor.
		expect(debeSeguirSondeando(false, false, false)).toBe(false);
		expect(debeSeguirSondeando(false, false, true)).toBe(false);
	});

	test('con el panel abierto se pregunta, salvo que la ventana esté tapada', () => {
		expect(debeSeguirSondeando(false, true, false)).toBe(true);
		expect(debeSeguirSondeando(false, true, true)).toBe(false);
	});
});

describe('debeRetomarSondeo', () => {
	test('al volver la ventana con el panel abierto se retoma', () => {
		expect(debeRetomarSondeo(false, true)).toBe(true);
	});

	test('con el panel cerrado no hay nada que retomar', () => {
		expect(debeRetomarSondeo(false, false)).toBe(false);
	});

	test('con la ventana todavía tapada tampoco', () => {
		expect(debeRetomarSondeo(true, true)).toBe(false);
		expect(debeRetomarSondeo(true, false)).toBe(false);
	});

	test('sin escaneo en curso, retomar es exactamente seguir sondeando', () => {
		// Que es lo que tiene que ser: retomar recupera el único caso que se
		// apaga solo. El escaneo en curso queda afuera porque con un escaneo en
		// curso el sondeo nunca se detuvo, y la inactividad de la sesión queda
		// afuera del todo: el escucha que dispara esto vive en el ciclo de vida
		// del panel, no en el de la detección de inactividad —que es donde
		// estaba colgado, y por eso no llegaba a registrarse nunca—.
		for (const oculto of [true, false]) {
			for (const panelAbierto of [true, false]) {
				expect(debeRetomarSondeo(oculto, panelAbierto)).toBe(
					debeSeguirSondeando(false, panelAbierto, oculto)
				);
			}
		}
	});
});

describe('intervaloDeSondeo', () => {
	test('el progreso se mira seguido y el reposo no', () => {
		expect(intervaloDeSondeo(true)).toBe(SONDEO_ACTIVO_MS);
		expect(intervaloDeSondeo(false)).toBe(SONDEO_EN_REPOSO_MS);
	});

	test('el intervalo activo tiene que ser bastante menor que el de reposo', () => {
		// Si se acercaran, el progreso del escaneo se vería a saltos; y si el de
		// reposo bajara, volveríamos al sondeo que esto vino a apagar.
		expect(SONDEO_ACTIVO_MS).toBeLessThan(SONDEO_EN_REPOSO_MS / 10);
	});
});

describe('la pausa al ocultarse es inmediata', () => {
	test('el mismo predicado gobierna cortar y retomar', () => {
		// Al ocultarse sin escaneo en curso hay que cortar el temporizador ya
		// agendado, no sólo dejar de reagendar: quedaba una consulta pendiente
		// que igual salía, con su IPC, después de que la ventana se tapó.
		expect(debeSeguirSondeando(false, true, true)).toBe(false);
		expect(debeRetomarSondeo(true, true)).toBe(false);
	});

	test('con un escaneo en curso ocultarse no corta nada', () => {
		// Cortar acá dejaría el escaneo sin nadie mirando si terminó, y el estado
		// congelado en «escaneando» hasta que alguien abriera el panel.
		expect(debeSeguirSondeando(true, false, true)).toBe(true);
	});
});
