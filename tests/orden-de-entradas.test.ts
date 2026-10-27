/**
 * El orden de las entradas sale de un solo lugar.
 *
 * Antes se ordenaba dos veces por dibujado y con criterios distintos: el
 * composable de entradas agrupaba las carpetas primero —y sólo en la lista— y
 * el componente de contenido **descartaba** ese resultado con un comparador
 * propio metido ahí adentro, que no agrupaba nada y comparaba nombres con
 * `toLowerCase()` y `localeCompare` sin `numeric`. Lo que se dibujaba salía del
 * componente y lo que recorrían el foco, el teclado y la selección salía del
 * composable: dos órdenes para la misma carpeta.
 *
 * Ahora hay uno solo, `sortFileBrowserEntries`, y lo leen la vista, el foco y el
 * teclado. La prueba que **no puede pasar sin el arreglo** es la de forma: el
 * componente ya no ordena por su cuenta. Las de comportamiento fijan el
 * contrato del orden compartido —carpetas primero, después la columna— y que el
 * teclado recorra el mismo arreglo que se dibuja; esas pasan con el código
 * viejo y con el nuevo, y evitan que la regresión vuelva por otro lado.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { computed, ref } from 'vue';
import {
	type SeccionVisual,
	vecinoLineal,
	vecinoVertical,
} from '@/composables/file-browser/recorrido-visual';
import { useFileBrowserEntries } from '@/composables/file-browser/use-file-browser-entries';
import type { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import type { DirEntry } from '@/types/dir-entry';
import type { ListSortColumn, ListSortDirection } from '@/types/short';
import { sortFileBrowserEntries } from '@/utils/file-browser-sort';
import { archivo, carpeta, makeDirEntry, nombres } from './support/dir-entry';

type DirSizesStore = ReturnType<typeof useDirSizesStore>;

/**
 * Un doble del store de tamaños, que acá sólo aporta el tamaño de una carpeta.
 *
 * La prueba mira el criterio del orden, no de dónde vino el número; calcular
 * tamaños de verdad sería montar medio backend para comprobar una comparación.
 */
function storeConTamanos(tamanos: Record<string, number> = {}): DirSizesStore {
	return {
		getSize: (path: string) => {
			const size = tamanos[path];
			return size === undefined
				? undefined
				: { size, status: 'Complete', fileCount: 0, dirCount: 0, calculatedAt: 0 };
		},
	} as unknown as DirSizesStore;
}

const entrada = makeDirEntry;
const sinTamanos = storeConTamanos();

describe('las carpetas van primero', () => {
	test('aunque el nombre del archivo iría antes alfabéticamente', () => {
		// Es la decisión de la vista: una carpeta `zzz` va antes que un archivo
		// `aaa.txt`. El comparador viejo del componente, que no agrupaba, las
		// mostraba al revés de como las recorrían las flechas.
		const resultado = sortFileBrowserEntries(
			[archivo('aaa.txt'), carpeta('zzz')],
			'name',
			'asc',
			sinTamanos
		);

		expect(nombres(resultado)).toEqual(['zzz', 'aaa.txt']);
	});

	test('y cada grupo queda junto, ordenado por la columna', () => {
		const resultado = sortFileBrowserEntries(
			[archivo('bv.txt'), carpeta('z'), archivo('av.txt'), carpeta('y')],
			'name',
			'asc',
			sinTamanos
		);

		expect(nombres(resultado)).toEqual(['y', 'z', 'av.txt', 'bv.txt']);
	});
});

describe('dentro de cada grupo manda la columna elegida', () => {
	test('nombre ascendente, con los números como números', () => {
		// Sin `numeric`, `informe10` va antes que `informe2`: el orden natural
		// es el que espera quien mira la lista.
		const resultado = sortFileBrowserEntries(
			[archivo('informe10.txt'), archivo('informe2.txt')],
			'name',
			'asc',
			sinTamanos
		);

		expect(nombres(resultado)).toEqual(['informe2.txt', 'informe10.txt']);
	});

	test('nombre descendente invierte', () => {
		const resultado = sortFileBrowserEntries(
			[archivo('a.txt'), archivo('c.txt'), archivo('b.txt')],
			'name',
			'desc',
			sinTamanos
		);

		expect(nombres(resultado)).toEqual(['c.txt', 'b.txt', 'a.txt']);
	});

	test('items, por la cantidad que tiene cada carpeta', () => {
		const resultado = sortFileBrowserEntries(
			[
				carpeta('llena', { item_count: 9 }),
				carpeta('vacia', { item_count: 0 }),
				carpeta('media', { item_count: 4 }),
			],
			'items',
			'asc',
			sinTamanos
		);

		expect(nombres(resultado)).toEqual(['vacia', 'media', 'llena']);
	});

	test('size, por el tamaño del archivo', () => {
		const resultado = sortFileBrowserEntries(
			[
				archivo('grande', { size: 300 }),
				archivo('chico', { size: 100 }),
				archivo('mediano', { size: 200 }),
			],
			'size',
			'asc',
			sinTamanos
		);

		expect(nombres(resultado)).toEqual(['chico', 'mediano', 'grande']);
	});

	test('size, por el tamaño de la carpeta que aporta el store', () => {
		const store = storeConTamanos({ '/casa/grande': 300, '/casa/chico': 1 });
		const resultado = sortFileBrowserEntries(
			[carpeta('grande'), carpeta('chico')],
			'size',
			'asc',
			store
		);

		expect(nombres(resultado)).toEqual(['chico', 'grande']);
	});

	test('modified, por la fecha', () => {
		const resultado = sortFileBrowserEntries(
			[
				archivo('nuevo', { modified_time: 300 }),
				archivo('viejo', { modified_time: 100 }),
				archivo('medio', { modified_time: 200 }),
			],
			'modified',
			'asc',
			sinTamanos
		);

		expect(nombres(resultado)).toEqual(['viejo', 'medio', 'nuevo']);
	});
});

describe('un empate conserva el orden en que llegaron', () => {
	test('mismo tamaño, mismo grupo', () => {
		const resultado = sortFileBrowserEntries(
			[archivo('zeta', { size: 100 }), archivo('alfa', { size: 100 })],
			'size',
			'asc',
			sinTamanos
		);

		// El `.sort()` es estable: con la clave igual no se reordena solo, y el
		// orden que trae el directorio se respeta.
		expect(nombres(resultado)).toEqual(['zeta', 'alfa']);
	});

	test('mismo nombre, distinta ruta', () => {
		const resultado = sortFileBrowserEntries(
			[archivo('igual', { path: '/casa/b/igual' }), archivo('igual', { path: '/casa/a/igual' })],
			'name',
			'asc',
			sinTamanos
		);

		expect(resultado.map((una) => una.path)).toEqual(['/casa/b/igual', '/casa/a/igual']);
	});
});

describe('la vista y el teclado recorren el mismo arreglo', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	test('lo que se dibuja es lo que recorre la flecha', () => {
		const dirContents = ref({
			path: '/casa',
			entries: [archivo('aaa.txt'), carpeta('zzz'), archivo('mmm.txt')],
			total_count: 3,
			dir_count: 1,
			file_count: 2,
		});
		const column = ref<ListSortColumn | null>('name');
		const direction = ref<ListSortDirection>('asc');
		// El sexto argumento habilitaba el orden en la firma vieja; la nueva
		// ordena siempre y lo ignora. Pasar el mismo en las dos deja esta prueba
		// corriendo contra el código de antes y el de ahora.
		const { entries } = useFileBrowserEntries(
			dirContents,
			ref(''),
			ref(true),
			column,
			direction,
			computed(() => true)
		);

		// El arreglo que la vista dibuja: carpetas primero, después el nombre.
		expect(nombres(entries.value)).toEqual(['zzz', 'aaa.txt', 'mmm.txt']);

		// Y el del teclado es ese mismo: la lista es una sola sección de una
		// columna, tal como la informa `FileBrowserListView`.
		const seccion: SeccionVisual[] = [{ entradas: entries.value, columnas: 1 }];

		expect(vecinoVertical(seccion, null, 'abajo')?.name).toBe('zzz');
		expect(vecinoLineal(seccion, null, 'siguiente')?.name).toBe('zzz');
		expect(vecinoLineal(seccion, '/casa/zzz', 'siguiente')?.name).toBe('aaa.txt');
	});
});

/**
 * La prueba que falla sin el arreglo.
 *
 * No alcanza con que el orden esté bien calculado en otro lado si el componente
 * lo vuelve a calcular: lo que se dibuja es lo suyo. Se lee el fuente y se
 * afirma que ese comparador no está, y que lo que dibuja sale del contexto.
 */
const RAIZ = join(import.meta.dir, '..');
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

describe('el componente ya no ordena por su cuenta', () => {
	const COMPONENTE = leer('src/components/filebrowser/FileBrowserContentComponent.vue');

	test('no hay un comparador propio: ni `.sort` ni el `switch` de columnas', () => {
		expect(COMPONENTE).not.toContain('.sort(');
		expect(COMPONENTE).not.toContain('switch (');
		expect(COMPONENTE).not.toContain('localeCompare');
	});

	test('las entradas que dibuja salen del contexto, ordenadas una sola vez', () => {
		// Las dos vistas —lista y cuadrícula— reciben el mismo arreglo que el
		// foco y el teclado.
		expect(COMPONENTE).toContain(':entries="ctx.entries.value"');
		expect(COMPONENTE).not.toContain('const sortedEntries');
	});

	test('el estado del orden se lee del contexto, no se declara adentro', () => {
		// Con un `ref` local, la cabecera elegía una columna que el arreglo
		// dibujado no seguía.
		expect(COMPONENTE).not.toContain('const listSortColumn = ref');
		expect(COMPONENTE).not.toContain('const listSortDirection = ref');
		expect(COMPONENTE).toContain('ctx.listSortColumn.value');
		expect(COMPONENTE).toContain('ctx.listSortDirection.value');
	});
});

describe('el orden sale de un solo lugar', () => {
	const ENTRIES = leer('src/composables/file-browser/use-file-browser-entries.ts');
	const FILE_BROWSER = leer('src/composables/file-browser/use-file-browser.ts');

	test('el composable de entradas ordena siempre, no sólo en la lista', () => {
		// Antes había un `applySort` que sólo dejaba ordenar con el layout de
		// lista: en la cuadrícula el arreglo del contexto salía sin ordenar y el
		// componente lo tapaba con el suyo.
		expect(ENTRIES).not.toContain('applySort');
		expect(ENTRIES).toContain('sortFileBrowserEntries(');
	});

	test('y el navegador ya no decide el orden por el layout', () => {
		expect(FILE_BROWSER).not.toContain('applyListSort');
	});
});
