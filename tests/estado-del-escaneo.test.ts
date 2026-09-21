import { describe, expect, test } from 'bun:test';
import {
	ESTADO_CANCELADO,
	ESTADO_COMPLETO,
	ESTADO_EN_CURSO,
	ESTADO_FALLADO,
	indiceEstaIncompleto,
} from '@/stores/runtime/global-search-estado';

describe('indiceEstaIncompleto', () => {
	test('un escaneo completo no necesita ningún aviso', () => {
		// Y es el único caso donde cero elementos significa de verdad que no hay
		// archivos. En todos los demás, cero puede ser un síntoma.
		expect(indiceEstaIncompleto(ESTADO_COMPLETO, false, false)).toBe(false);
	});

	test('cancelado y fallado sí, porque falta parte del disco', () => {
		expect(indiceEstaIncompleto(ESTADO_CANCELADO, false, false)).toBe(true);
		expect(indiceEstaIncompleto(ESTADO_FALLADO, false, false)).toBe(true);
	});

	test('un «en curso» vencido es un escaneo que murió de golpe', () => {
		// El caso del reinicio: el proceso que escribió el estado ya no está,
		// pero el archivo sigue diciendo que está indexando. Sin esto la ventana
		// mostraría «indexando» para siempre y nadie podría destrabarlo.
		expect(indiceEstaIncompleto(ESTADO_EN_CURSO, false, false)).toBe(true);
	});

	test('un «en curso» que todavía vale no es un problema', () => {
		expect(indiceEstaIncompleto(ESTADO_EN_CURSO, true, false)).toBe(false);
	});

	test('mientras se escanea acá no se avisa nada', () => {
		// Ya está el progreso a la vista; un aviso al lado sería ruido, y encima
		// diría que falta algo que se está juntando en ese mismo momento.
		expect(indiceEstaIncompleto(ESTADO_CANCELADO, false, true)).toBe(false);
		expect(indiceEstaIncompleto(ESTADO_FALLADO, false, true)).toBe(false);
	});

	test('que falte el estado se trata como completo', () => {
		// Lo escribió una versión anterior, que no tenía cómo avisar. Si acá se
		// avisara, cada instalación sin actualizar mostraría el aviso
		// permanentemente por algo que siempre funcionó así.
		expect(indiceEstaIncompleto(null, false, false)).toBe(false);
	});

	test('un valor que no conocemos se trata al revés: se avisa', () => {
		// Lo escribió una versión más nueva, que sabe algo que nosotros no. No
		// podemos afirmar que esté completo, así que no lo afirmamos.
		//
		// Es la mitad de la regla que más fácil se «arregla» por parecer
		// inconsistente con la de arriba, y por eso tiene su propia prueba.
		expect(indiceEstaIncompleto('partial', false, false)).toBe(true);
		expect(indiceEstaIncompleto('', false, false)).toBe(true);
	});
});
