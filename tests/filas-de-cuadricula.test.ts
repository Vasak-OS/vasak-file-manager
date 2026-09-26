import { describe, expect, test } from 'bun:test';
import {
	columnasQueEntran,
	enFilas,
	SEPARACION_PX,
} from '../src/composables/file-browser/filas-de-cuadricula';
import type { DirEntry } from '../src/types/dir-entry';

/**
 * La aritmética que decide dónde se corta cada fila de la cuadrícula.
 *
 * Equivocarse acá no da un error: deja tarjetas que se pisan o huecos entre
 * filas, y eso sólo se ve mirando. Por eso está aparte del componente y por eso
 * se prueba con los números de verdad de la vista —180 px de ancho mínimo para
 * las carpetas, 170 para el resto, 12 de separación—.
 */
const entrada = (name: string): DirEntry => ({ name, path: `/dir/${name}` }) as DirEntry;
const entradas = (n: number) => Array.from({ length: n }, (_, i) => entrada(`e${i}`));

describe('cuántas tarjetas entran a lo ancho', () => {
	test('es la misma cuenta que hace `auto-fill minmax(min, 1fr)`', () => {
		// Con 180 de mínimo y 12 de separación, tres tarjetas necesitan
		// 180*3 + 12*2 = 564.
		expect(columnasQueEntran(564, 180)).toBe(3);
		expect(columnasQueEntran(563, 180)).toBe(2);
		expect(columnasQueEntran(576, 180)).toBe(3);
	});

	test('el ancho justo de una tarjeta da una columna', () => {
		expect(columnasQueEntran(180, 180)).toBe(1);
		expect(columnasQueEntran(170, 170)).toBe(1);
	});

	/**
	 * Pasa de verdad: la sección está oculta, o todavía no se midió. Devolver
	 * cero columnas dejaría el corte en un bucle infinito.
	 */
	test('sin ancho todavía, una columna y no cero', () => {
		for (const ancho of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(columnasQueEntran(ancho, 180)).toBe(1);
		}
	});

	test('un ancho enorme no se va de escala', () => {
		expect(columnasQueEntran(1920, 170)).toBe(Math.floor((1920 + 12) / 182));
	});

	test('la separación es la del CSS', () => {
		// Si alguien cambia el `gap-3` de la vista, este número tiene que
		// acompañar o las filas quedan corridas.
		expect(SEPARACION_PX).toBe(12);
	});
});

describe('cortar en filas', () => {
	test('la última fila queda incompleta y no se rellena', () => {
		const filas = enFilas(entradas(7), 3);

		expect(filas.map((f) => f.entradas.length)).toEqual([3, 3, 1]);
	});

	test('cada entrada aparece una sola vez y en orden', () => {
		const filas = enFilas(entradas(10), 4);
		const planas = filas.flatMap((f) => f.entradas.map((e) => e.name));

		expect(planas).toEqual(entradas(10).map((e) => e.name));
	});

	test('la clave de la fila es su primera entrada', () => {
		// Cambia cuando cambia el contenido de la fila, que es cuando el
		// desplazador tiene que rehacerla.
		const filas = enFilas(entradas(5), 2);

		expect(filas.map((f) => f.clave)).toEqual(['/dir/e0', '/dir/e2', '/dir/e4']);
	});

	test('sin entradas no hay filas', () => {
		expect(enFilas([], 3)).toEqual([]);
	});

	test('cero por fila no cuelga', () => {
		// Con un ancho todavía sin medir, `porFila` puede llegar en cero: sin
		// este piso, el bucle no avanza nunca.
		const filas = enFilas(entradas(3), 0);

		expect(filas).toHaveLength(3);
		expect(filas.every((f) => f.entradas.length === 1)).toBe(true);
	});

	test('más columnas que entradas es una sola fila', () => {
		expect(enFilas(entradas(2), 8)).toHaveLength(1);
	});
});
