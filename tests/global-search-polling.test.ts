import { describe, expect, test } from 'bun:test';
import {
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
