/**
 * El orden que llega al navegador, de verdad.
 *
 * Las pruebas de `orden-de-entradas.test.ts` fijan el comparador y la forma del
 * componente; éstas montan el navegador entero —`FileBrowserComponent`, que es
 * lo que el usuario abre— para comprobar el camino completo: que el estado del
 * orden sale por el contexto y arranca en nombre ascendente, que **hacer clic en
 * una cabecera** cambia el criterio del arreglo dibujado, que las carpetas van
 * primero, que lo mismo rige para los resultados de la búsqueda global y que la
 * flecha recorre el mismo arreglo que se ve.
 *
 * Es lo que ninguna prueba tocaba: la cabecera de la lista escribe en la única
 * fuente y el arreglo del contexto se reordena con ese criterio.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick } from 'vue';
import FileBrowserComponent from '@/components/filebrowser/FileBrowserComponent.vue';
import { useFileBrowserContext } from '@/composables/file-browser/use-file-browser-context';
import type { DirEntry } from '@/types/dir-entry';
import type { Tab } from '@/types/workspaces';
import { olvidarTodo, responder } from './dobles';
import { archivo, carpeta, makeDirEntry } from './support/dir-entry';

let vista: VueWrapper | null = null;

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	responder('get_active_calculations', []);
	responder('get_dir_sizes_batch', []);
	responder('get_dir_size', null);
	// El directorio que se abre: dos carpetas con nombre y fecha que no
	// acompañan el orden por nombre, para que el agrupado se note.
	responder('read_dir', () => directorio);
	responder('watch_directory', null);
});

afterEach(() => {
	vista?.unmount();
	vista = null;
});

const _entrada = makeDirEntry;

/**
 * El contenido de `/casa`.
 *
 * Dos carpetas y dos archivos cuyos nombres y fechas no se corresponden: por
 * nombre las carpetas irían después de los archivos, y por fecha quedan
 * mezclados. Es a propósito: así el orden por nombre, el de fecha y el de fecha
 * al revés dan resultados distintos, y ninguno coincide con lo que daría el
 * comparador que el componente tenía antes —que no agrupaba carpetas—, así que
 * cada afirmación distingue el orden compartido del viejo.
 */
const entradas = [
	archivo('aaa.txt', { modified_time: 300 }),
	carpeta('zzz', { modified_time: 350 }),
	archivo('mmm.txt', { modified_time: 100 }),
	carpeta('bbb', { modified_time: 5 }),
];

const directorio = {
	path: '/casa',
	entries: entradas,
	total_count: 4,
	dir_count: 2,
	file_count: 2,
};

/** Por nombre, con las carpetas primero: `bbb` y `zzz` antes que los archivos. */
const POR_NOMBRE = 'bbb,zzz,aaa.txt,mmm.txt';
/** Por fecha y con las carpetas primero: `mmm` (100) antes que `aaa` (300). */
const POR_FECHA = 'bbb,zzz,mmm.txt,aaa.txt';
/** Por fecha al revés: cambia el orden dentro de cada grupo. */
const POR_FECHA_AL_REVES = 'zzz,bbb,aaa.txt,mmm.txt';

/** La vista de lista, reducida a los nombres: es el orden que se dibuja. */
const ListaDoble = defineComponent({
	name: 'FileBrowserListView',
	props: { entries: { type: Array, required: true } },
	setup(props) {
		return () =>
			h(
				'div',
				{ 'data-lista': '' },
				(props.entries as DirEntry[]).map((una) => una.name).join(',')
			);
	},
});

const RejillaDoble = defineComponent({
	name: 'FileBrowserGridView',
	props: { entries: { type: Array, required: true } },
	setup(props) {
		return () =>
			h(
				'div',
				{ 'data-rejilla': '' },
				(props.entries as DirEntry[]).map((una) => una.name).join(',')
			);
	},
});

const hijosPesados = {
	FileBrowserListView: ListaDoble,
	FileBrowserGridView: RejillaDoble,
	FileBrowserToolbarComponent: true,
	FileBrowserStatusBarComponent: true,
	RenameDialogComponent: true,
	NewItemDialogComponent: true,
	OpenWithDialogComponent: true,
	CompressDialogComponent: true,
	ConflictDialogComponent: true,
	DragOverlayComponent: true,
	InboundDragOverlayComponent: true,
};

/**
 * Espía del contexto: en vez de dibujar la lista, dice con qué orden quedó.
 *
 * El estado del orden vive en la fuente de datos y viaja por el contexto; esto
 * mira ese contrato y no la vista, que es donde podría cambiarse la una sin la
 * otra.
 */
const SondaDelContexto = defineComponent({
	name: 'FileBrowserContentComponent',
	props: { layout: { type: String, required: false } },
	setup() {
		const ctx = useFileBrowserContext();

		return () =>
			h('div', { 'data-sonda': '' }, `${ctx.listSortColumn.value}/${ctx.listSortDirection.value}`);
	},
});

function montarNavegador(
	campos: { externalEntries?: DirEntry[]; layout?: 'list' | 'grid'; content?: object } = {}
) {
	const tab = { id: 'tab-1', path: '/casa' } as Tab;

	vista = mount(FileBrowserComponent, {
		props: {
			tab,
			layout: campos.layout ?? 'list',
			externalEntries: campos.externalEntries,
			hideToolbar: true,
			hideStatusBar: true,
		},
		global: { stubs: { ...hijosPesados, ...campos.content } },
	});

	return vista;
}

/** Deja correr la lectura del directorio y el dibujado. */
async function asentar() {
	await nextTick();
	await new Promise((listo) => setTimeout(listo, 0));
	await nextTick();
	await new Promise((listo) => setTimeout(listo, 0));
	await nextTick();
}

/** Lo que se ve en la lista, en orden. */
const ordenDibujado = () => (vista as VueWrapper).get('[data-lista]').text();

/** Lo que recibe la cuadrícula, en orden. */
const ordenDeLaCuadricula = () => (vista as VueWrapper).get('[data-rejilla]').text();

/** Lo que el contexto dice del orden: columna y dirección. */
const ordenDelContexto = () => (vista as VueWrapper).get('[data-sonda]').text();

/** La cabecera cuyo rótulo es la clave de traducción. */
function cabecera(clave: string) {
	return (vista as VueWrapper).findAll('button').find((boton) => boton.text() === clave);
}

describe('el orden vive en el contexto y arranca por nombre ascendente', () => {
	test('mirando una carpeta', async () => {
		montarNavegador({ content: { FileBrowserContentComponent: SondaDelContexto } });
		await asentar();

		expect(ordenDelContexto()).toBe('name/asc');
	});

	test('y con los resultados de la búsqueda global', async () => {
		montarNavegador({
			externalEntries: entradas,
			content: { FileBrowserContentComponent: SondaDelContexto },
		});
		await asentar();

		expect(ordenDelContexto()).toBe('name/asc');
	});
});

describe('el navegador arranca con el orden por nombre', () => {
	test('ascendente y con las carpetas primero', async () => {
		montarNavegador();
		await asentar();

		// `bbb` y `zzz` son carpetas: van antes que `aaa.txt` aunque por nombre
		// fueran después.
		expect(ordenDibujado()).toBe(POR_NOMBRE);
	});
});

describe('la cabecera escribe en la única fuente del orden', () => {
	test('al hacer clic en «modificado» cambia el criterio del arreglo dibujado', async () => {
		montarNavegador();
		await asentar();
		expect(ordenDibujado()).toBe(POR_NOMBRE);

		await cabecera('fileBrowser.modified')?.trigger('click');
		await asentar();

		// Sigue agrupando carpetas, y adentro de cada grupo manda la fecha:
		// `mmm` (100) antes que `aaa` (300). Con el comparador viejo —sin
		// agrupar— esta lectura no aparecía.
		expect(ordenDibujado()).toBe(POR_FECHA);
	});

	test('y el segundo clic en la misma columna invierte la dirección', async () => {
		montarNavegador();
		await asentar();

		await cabecera('fileBrowser.modified')?.trigger('click');
		await asentar();
		await cabecera('fileBrowser.modified')?.trigger('click');
		await asentar();

		expect(ordenDibujado()).toBe(POR_FECHA_AL_REVES);
	});
});

describe('la búsqueda global también ordena por el mismo lugar', () => {
	test('con las carpetas primero', async () => {
		montarNavegador({ externalEntries: entradas, layout: 'list' });
		await asentar();

		expect(ordenDibujado()).toBe(POR_NOMBRE);
	});
});

describe('la cuadrícula recibe el mismo orden que la lista', () => {
	test('con las carpetas primero, sin que el layout decida si se ordena', async () => {
		// El agrupado no depende de la vista: lo que sale del contexto y llega a
		// la cuadrícula ya está ordenado.
		montarNavegador({ layout: 'grid' });
		await asentar();

		expect(ordenDeLaCuadricula()).toBe(POR_NOMBRE);
	});
});

describe('la flecha recorre el mismo arreglo que se dibuja', () => {
	test('las dos primeras bajadas caen en las dos primeras filas', async () => {
		const navegador = montarNavegador();
		await asentar();

		const dibujado = ordenDibujado().split(',');

		// Se compara contra lo dibujado y no contra una lista escrita a mano: es
		// lo único que dice que las flechas van por el arreglo que se ve. Antes
		// iban por otro y la primera bajada ya caía en una fila distinta.
		navegador.vm.navigateDown();
		await asentar();
		expect(navegador.vm.selectedEntries[0]?.name).toBe(dibujado[0]);

		navegador.vm.navigateDown();
		await asentar();
		expect(navegador.vm.selectedEntries[0]?.name).toBe(dibujado[1]);
	});
});
