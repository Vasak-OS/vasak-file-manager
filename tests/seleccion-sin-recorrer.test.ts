import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Preguntar si una fila está seleccionada no puede costar un recorrido.
 *
 * `isEntrySelected` se llama **una vez por fila en cada dibujado** —dos en la
 * vista de lista, para el atributo `data-selected` y para el icono— así que un
 * recorrido lineal adentro hace el total cuadrático. Con «seleccionar todo» en
 * `/usr/bin`, que en una máquina común son 3585 entradas, son casi trece
 * millones de comparaciones de cadenas por dibujado.
 *
 * Medido con esos números: 46,9 ms con `some`, 0,2 ms con un `Set`. Cuarenta y
 * siete milisegundos son tres cuadros perdidos, en cada dibujado.
 */
const RAIZ = join(import.meta.dir, '..');
const SELECCION = readFileSync(
	join(RAIZ, 'src', 'composables', 'file-browser', 'use-file-browser-selection.ts'),
	'utf8'
);

/** El cuerpo de una función suelta del archivo. */
function cuerpoDe(fuente: string, nombre: string): string {
	const desde = fuente.indexOf(`function ${nombre}(`);
	if (desde < 0) throw new Error(`no está la función ${nombre}`);
	const fin = fuente.indexOf('\n\t}', desde);
	return fuente.slice(desde, fin);
}

describe('isEntrySelected', () => {
	test('pregunta a un conjunto, no recorre la selección', () => {
		const cuerpo = cuerpoDe(SELECCION, 'isEntrySelected');

		expect(cuerpo).toContain('rutasSeleccionadas.value.has(entry.path)');
		for (const recorrido of ['.some(', '.find(', '.findIndex(', '.includes(', 'for (']) {
			expect(cuerpo).not.toContain(recorrido);
		}
	});

	/**
	 * El conjunto es derivado y no mantenido a mano a propósito: la selección se
	 * reemplaza desde seis lugares —limpiar, rango, sumar, sacar, elegir una y
	 * seleccionar todo— y cualquiera que se olvidara de actualizarlo dejaría
	 * filas mintiendo sobre su propio estado, que es el peor modo de fallar acá:
	 * se ve como «a veces no se marca» y no como un error.
	 */
	test('el conjunto se deriva de la selección, no se mantiene aparte', () => {
		expect(SELECCION).toContain('const rutasSeleccionadas = computed(');
		expect(SELECCION).toContain('new Set(selectedEntries.value.map((entrada) => entrada.path))');
	});

	test('nadie más escribe en ese conjunto', () => {
		// Si apareciera un `.add(` o un `.delete(` sobre él, dejó de ser derivado.
		expect(SELECCION).not.toContain('rutasSeleccionadas.value.add');
		expect(SELECCION).not.toContain('rutasSeleccionadas.value.delete');
		expect(SELECCION).not.toContain('rutasSeleccionadas.value.clear');
	});
});

describe('la selección sigue teniendo su lista', () => {
	test('lo que se le pasa a quien escucha sigue siendo las entradas', () => {
		// El conjunto es para preguntar rápido; lo que el resto de la aplicación
		// consume —copiar, comprimir, el panel de información— son las entradas
		// enteras, no las rutas.
		expect(SELECCION).toContain('onSelect(selectedEntries.value)');
	});
});
