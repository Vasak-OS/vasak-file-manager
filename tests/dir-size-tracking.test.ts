import { describe, expect, test } from 'bun:test';
import {
	debeSondear,
	progresoAplicable,
	type ProgresoDeCalculo,
} from '../src/stores/runtime/dir-size-tracking';

function calculo(path: string, size: number): ProgresoDeCalculo {
	return { path, size, file_count: 1, dir_count: 0 };
}

describe('cuándo sondear', () => {
	test('sin nada que seguir no se despierta', () => {
		// Éste es el caso que dejaba un temporizador latiendo para siempre: la
		// última carpeta terminaba su cálculo y nadie apagaba el reloj.
		expect(debeSondear(new Set(), false)).toBe(false);
	});

	test('con algo que seguir y la ventana a la vista, sí', () => {
		expect(debeSondear(new Set(['/home/pato']), false)).toBe(true);
	});

	test('con la ventana tapada no se sondea aunque haya cálculos', () => {
		// Los tamaños se siguen calculando en el backend; lo que se suspende es
		// preguntar por ellos, porque no hay quien los mire.
		expect(debeSondear(new Set(['/home/pato']), true)).toBe(false);
	});

	test('varias carpetas siguen necesitando un solo temporizador', () => {
		// El punto del cambio: veinte carpetas no son veinte relojes.
		const muchas = new Set(['/a', '/b', '/c', '/d']);
		expect(debeSondear(muchas, false)).toBe(true);
	});
});

describe('a qué aplicar el progreso', () => {
	test('sólo a las carpetas que se están siguiendo', () => {
		// El backend informa todos los cálculos en curso, incluidos los de
		// carpetas que ya se cerraron. Aplicarlos dejaba tamaños pegados en la
		// vista que nadie había pedido.
		const activos = [calculo('/a', 100), calculo('/ajena', 999)];
		const salida = progresoAplicable(activos, new Set(['/a']));

		expect(salida).toHaveLength(1);
		expect(salida[0].path).toBe('/a');
	});

	test('un tamaño en cero todavía no es un resultado', () => {
		// Un cálculo que arrancó y no encontró nada todavía informa cero;
		// escribirlo mostraría «0 B» en una carpeta que sí tiene contenido.
		const salida = progresoAplicable([calculo('/a', 0)], new Set(['/a']));
		expect(salida).toHaveLength(0);
	});

	test('sin cálculos activos no hay nada que aplicar', () => {
		expect(progresoAplicable([], new Set(['/a']))).toHaveLength(0);
	});

	test('sin seguimiento se descarta todo', () => {
		const activos = [calculo('/a', 10), calculo('/b', 20)];
		expect(progresoAplicable(activos, new Set())).toHaveLength(0);
	});

	test('se conservan los conteos, no sólo el tamaño', () => {
		// La vista muestra archivos y carpetas además del tamaño; perderlos
		// dejaba los contadores en cero mientras el tamaño subía.
		const activos: ProgresoDeCalculo[] = [
			{ path: '/a', size: 500, file_count: 12, dir_count: 3 },
		];
		const [salida] = progresoAplicable(activos, new Set(['/a']));

		expect(salida.file_count).toBe(12);
		expect(salida.dir_count).toBe(3);
	});
});
