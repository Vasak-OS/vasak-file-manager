/**
 * Favoritos y recientes en la barra lateral (#142, #143): lo que no es la barra.
 *
 * La barra dibuja dos secciones nuevas con lo que guarda el almacén de
 * estadísticas de uso, y para que un archivo favorito se abra en su carpeta
 * hace falta que el favorito recuerde *qué era* cuando se lo ancló. Acá van
 * las piezas de abajo: el nombre que se muestra, lo que se guarda, y los dos
 * caminos que anclan (el menú contextual y Ctrl+D). Las secciones montadas
 * están en `sidebar.test.ts`.
 *
 * El disco es un `Map` detrás del doble de `invoke`: «cerrar y volver a abrir»
 * es un pinia nuevo contra el mismo mapa.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import FileBrowserComponent from '@/components/filebrowser/FileBrowserComponent.vue';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import { useFileBrowserSelection } from '@/composables/file-browser/use-file-browser-selection';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useUserStatsStore } from '@/stores/storage/user-stats';
import type { DirEntry } from '@/types/dir-entry';
import { basename } from '@/utils/path';
import { olvidarTodo, responder } from './dobles';
import { archivo, carpeta } from './support/dir-entry';

const disco = new Map<string, unknown>();

beforeEach(() => {
	olvidarTodo();
	disco.clear();
	responder('plugin:store|load', 1);
	responder('plugin:store|save', undefined);
	responder('plugin:store|set', ({ key, value }) => {
		// JSON y no `structuredClone`: lo que llega es un proxy reactivo de Vue.
		disco.set(key as string, JSON.parse(JSON.stringify(value)));
	});
	responder('plugin:store|get', ({ key }) => [disco.get(key as string), disco.has(key as string)]);
	responder('plugin:store|entries', () => [...disco.entries()]);
	// Todo existe: la limpieza de rutas muertas no tiene que borrar lo que se mira.
	responder('path_exists', true);
	responder('get_active_calculations', []);
});

/**
 * Abrir la aplicación: un pinia nuevo, el mismo disco.
 *
 * Las listas se reemplazan antes de arrancar: `DEFAULT_USER_STATS` se copia
 * superficialmente, así que sus arrays los comparten todos los almacenes del
 * proceso y lo que una prueba ancla lo ve la siguiente.
 */
async function abrirLaAplicacion() {
	setActivePinia(createPinia());
	useUserPathsStore().customPaths.appUserDataStatsPath = '/datos/user-stats.json';
	const store = useUserStatsStore();
	store.userStats.favorites = [];
	store.userStats.history = [];
	await store.init();
	return store;
}

/** Deja correr las promesas pendientes. */
const vaciarPromesas = async () => {
	for (let i = 0; i < 8; i++) await new Promise((sigue) => setTimeout(sigue, 0));
};

describe('basename', () => {
	test('devuelve el último segmento de la ruta', () => {
		expect(basename('/home/pato/Documentos')).toBe('Documentos');
		expect(basename('/home/pato/informe.pdf')).toBe('informe.pdf');
	});

	test('ignora la barra final: una carpeta con y sin ella se llama igual', () => {
		expect(basename('/home/pato/Documentos/')).toBe('Documentos');
		expect(basename('/home/pato/Documentos///')).toBe('Documentos');
	});

	test('la raíz se llama «/», no queda vacía', () => {
		expect(basename('/')).toBe('/');
	});

	test('una ruta sin barras se devuelve entera', () => {
		expect(basename('solo')).toBe('solo');
	});

	test('un segmento de un solo nivel bajo la raíz', () => {
		expect(basename('/tmp')).toBe('tmp');
	});
});

describe('anclar a favoritos', () => {
	test('un archivo se guarda como archivo', async () => {
		const store = await abrirLaAplicacion();

		await store.addToFavorites('/casa/informe.pdf', true);

		expect(store.favorites).toHaveLength(1);
		expect(store.favorites[0]).toMatchObject({ path: '/casa/informe.pdf', isFile: true });
	});

	test('sin decir qué es, se guarda como carpeta', async () => {
		const store = await abrirLaAplicacion();

		await store.addToFavorites('/casa/Documentos');

		expect(store.favorites[0]).toMatchObject({ path: '/casa/Documentos', isFile: false });
	});

	test('anclar dos veces lo mismo no lo duplica ni le cambia el tipo', async () => {
		const store = await abrirLaAplicacion();

		await store.addToFavorites('/casa/x', true);
		await store.addToFavorites('/casa/x', false);

		expect(store.favorites).toHaveLength(1);
		expect(store.favorites[0].isFile).toBe(true);
	});

	test('alternar un archivo lo agrega como archivo y al repetir lo quita', async () => {
		const store = await abrirLaAplicacion();

		expect(await store.toggleFavorite('/casa/informe.pdf', true)).toBe(true);
		expect(store.favorites[0]).toMatchObject({ path: '/casa/informe.pdf', isFile: true });

		expect(await store.toggleFavorite('/casa/informe.pdf', true)).toBe(false);
		expect(store.favorites).toEqual([]);
	});

	test('alternar sin decir qué es agrega una carpeta', async () => {
		const store = await abrirLaAplicacion();

		await store.toggleFavorite('/casa/Documentos');

		expect(store.favorites[0].isFile).toBe(false);
	});

	test('un archivo favorito sigue siendo archivo al volver a abrir la aplicación', async () => {
		// Si el tipo no se guardara, al reabrir el favorito se abriría como
		// carpeta y fallaría al listar un archivo.
		const primera = await abrirLaAplicacion();
		await primera.addToFavorites('/casa/informe.pdf', true);
		await primera.addToFavorites('/casa/Documentos', false);

		const segunda = await abrirLaAplicacion();

		expect(segunda.favorites.map((f) => [f.path, f.isFile])).toEqual([
			['/casa/informe.pdf', true],
			['/casa/Documentos', false],
		]);
	});
});

describe('«Agregar a favoritos» del menú contextual', () => {
	/** El composable de selección con el menú abierto sobre las entradas dadas. */
	function conMenuSobre(entradas: DirEntry[]) {
		const seleccion = useFileBrowserSelection(
			ref(entradas),
			ref('/casa'),
			() => {},
			() => {},
			() => {}
		);
		seleccion.contextMenu.value.selectedEntries = entradas;
		return seleccion;
	}

	test('un archivo queda anclado como archivo', async () => {
		const store = await abrirLaAplicacion();
		const { handleContextMenuAction } = conMenuSobre([archivo('informe.pdf')]);

		handleContextMenuAction('toggle-favorite');
		await vaciarPromesas();

		expect(store.favorites.map((f) => [f.path, f.isFile])).toEqual([['/casa/informe.pdf', true]]);
	});

	test('una carpeta queda anclada como carpeta', async () => {
		const store = await abrirLaAplicacion();
		const { handleContextMenuAction } = conMenuSobre([carpeta('Documentos')]);

		handleContextMenuAction('toggle-favorite');
		await vaciarPromesas();

		expect(store.favorites.map((f) => [f.path, f.isFile])).toEqual([['/casa/Documentos', false]]);
	});

	test('con una mezcla cada entrada lleva su propio tipo', async () => {
		const store = await abrirLaAplicacion();
		const { handleContextMenuAction } = conMenuSobre([archivo('a.txt'), carpeta('b')]);

		handleContextMenuAction('toggle-favorite');
		await vaciarPromesas();

		expect(store.favorites.map((f) => [f.path, f.isFile])).toEqual([
			['/casa/a.txt', true],
			['/casa/b', false],
		]);
	});
});

describe('Ctrl+D ancla la carpeta actual', () => {
	let vista: VueWrapper | undefined;

	beforeEach(async () => {
		await abrirLaAplicacion();
	});

	afterEach(() => {
		vista?.unmount();
		vista = undefined;
	});

	/**
	 * La barra del navegador montada, que es quien registra el manejador, con
	 * los hijos pesados apagados: lo que se prueba es el manejador.
	 */
	function barraDelNavegador() {
		vista = mount(NavigatorBarComponent, {
			global: {
				stubs: {
					FileBrowserComponent: true,
					GlobalSearchView: true,
					ClipboardToolbarComponent: true,
				},
			},
		});
		return vista;
	}

	/** El panel avisa qué carpeta está mirando, como lo hace al navegar. */
	async function mirandoLa(ruta: string) {
		const barra = barraDelNavegador();
		barra
			.findComponent(FileBrowserComponent)
			.vm.$emit('update:current-dir-entry', carpeta('actual', { path: ruta }));
		await barra.vm.$nextTick();
	}

	/** Ctrl+D, por el mismo camino que lo recibe la aplicación. */
	const apretarCtrlD = () =>
		useShortcutsStore().handleKeydown(
			new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true, cancelable: true })
		);

	test('está definido como Ctrl+D en el navegador', () => {
		const definicion = useShortcutsStore().getShortcutDefinition('addBookmark');

		expect(definicion?.defaultKeys).toEqual({ ctrl: true, key: 'd' });
		expect(definicion?.scope).toBe('navigator');
		expect(definicion?.labelKey).toBe('shortcuts.addBookmark');
	});

	test('agrega la carpeta que se está viendo, como carpeta', async () => {
		await mirandoLa('/casa/pato/Documentos');

		expect(await apretarCtrlD()).toBe(true);

		const favoritos = useUserStatsStore().favorites;
		expect(favoritos).toHaveLength(1);
		expect(favoritos[0]).toMatchObject({ path: '/casa/pato/Documentos', isFile: false });
	});

	test('y queda guardada en el disco', async () => {
		await mirandoLa('/casa/pato/Documentos');

		await apretarCtrlD();

		expect(disco.get('favorites')).toMatchObject([
			{ path: '/casa/pato/Documentos', isFile: false },
		]);
	});

	test('apretarlo otra vez no la duplica', async () => {
		await mirandoLa('/casa/pato/Documentos');

		await apretarCtrlD();
		await apretarCtrlD();

		expect(useUserStatsStore().favorites).toHaveLength(1);
	});

	test('sin carpeta actual no ancla nada', async () => {
		// Guarda, no comportamiento nuevo: antes tampoco anclaba nada.
		barraDelNavegador();

		await apretarCtrlD();

		expect(useUserStatsStore().favorites).toEqual([]);
	});
});
