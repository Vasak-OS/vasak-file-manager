/**
 * El botón que ofrecía unos ajustes que no existen.
 *
 * En el estado «todavía no escribiste nada» había un botón «mostrar ajustes de
 * búsqueda». Su manejador era `function openSearchSettings() {}` —una función
 * vacía—, así que apretarlo no hacía nada.
 *
 * Y no era que faltara conectarlo: **no hay ninguna pantalla de ajustes de la
 * búsqueda**, ni en esta aplicación ni en vasak-settings. Lo que habría que
 * ajustar —la profundidad del recorrido, las rutas ignoradas, el recorrido en
 * paralelo, las unidades elegidas— está comentado en el store, y hoy son
 * valores fijos.
 *
 * Así que se va, con su clave y con el icono que sólo usaba él. Lo que queda
 * en ese estado es lo que sí es cierto: cuánto hay indexado, hasta qué
 * profundidad y desde cuándo.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import GlobalSearchView from '@/views/GlobalSearchView.vue';
import { olvidarTodo, responder } from './dobles';

/** Deja que terminen las promesas del montaje. */
async function asentar(vueltas = 6) {
	for (let i = 0; i < vueltas; i++) {
		await Promise.resolve();
		await new Promise((sigue) => setTimeout(sigue, 0));
	}
}

let vista: VueWrapper | null = null;

afterEach(() => {
	// `useReactiveIcon` cuenta cuántos la usan en una variable del módulo: una
	// vista que queda montada se lleva puesta la prueba del cambio de tema de
	// otro archivo.
	vista?.unmount();
	vista = null;
});

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
});

/**
 * El panel con algo indexado, que es cuando se ve ese estado.
 *
 * El comando es `global_search_get_status`. Vale decirlo porque las otras
 * pruebas de la búsqueda le contestaban a `get_index_status`, que no existe:
 * daban el resultado buscado —un índice vacío— pero por no contestar nada, no
 * por lo que decían contestar.
 */
async function conIndice() {
	responder('global_search_get_status', {
		is_scan_in_progress: false,
		indexed_item_count: 1234,
	});
	vista = mount(GlobalSearchView);
	// La vista pide el estado del índice cuando el panel **se abre**: el
	// observador de `isOpen` es quien llama a `refreshStatus`. Montada y
	// cerrada se queda con el índice en cero, que es otro estado vacío.
	await useGlobalSearchStore().open();
	await asentar();
	return vista;
}

describe('el estado de antes de escribir', () => {
	test('ya no ofrece unos ajustes que no existen', async () => {
		const panel = await conIndice();

		expect(panel.text()).not.toContain('showSearchSettings');
	});

	test('y sigue diciendo lo que sí es cierto del índice', async () => {
		// Sacar el botón no tenía que llevarse el resto del cartel.
		const panel = await conIndice();

		const texto = panel.text();
		expect(texto).toContain('globalSearch.globalSearch');
		expect(texto).toContain('globalSearch.searchStats.searched');
	});
});

describe('lo que quedaba colgando', () => {
	test('el manejador vacío se fue con el botón', async () => {
		// Una función vacía con nombre de acción es una promesa escrita en el
		// código: el próximo que la lea va a creer que hay algo conectado.
		const fuente = await Bun.file(
			new URL('../src/views/GlobalSearchView.vue', import.meta.url)
		).text();

		// Sobre la declaración y sobre el enganche, no sobre el nombre suelto:
		// el comentario que quedó en el lugar del botón cuenta qué pasó.
		expect(fuente).not.toContain('function openSearchSettings');
		expect(fuente).not.toContain('@click="openSearchSettings"');
	});

	test('y la clave se fue de los dos catálogos', async () => {
		for (const idioma of ['en', 'es']) {
			const catalogo = await Bun.file(
				new URL(`../src-tauri/locales/${idioma}.yml`, import.meta.url)
			).text();

			expect(catalogo).not.toContain('showSearchSettings');
		}
	});
});

describe('el atajo que estaba definido y no hacía nada', () => {
	/**
	 * `toggleGlobalSearch` está en la lista de atajos desde siempre —Ctrl+Shift+F,
	 * con su etiqueta traducida y editable desde los ajustes— y nunca se le
	 * registró un manejador. O sea que aparecía como si existiera y la tecla no
	 * hacía nada: la misma mitad que le faltaba al botón de la barra.
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

	/** Ctrl+Shift+F, por el mismo camino que lo recibe la aplicación. */
	async function apretarElAtajo() {
		return await useShortcutsStore().handleKeydown(
			new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true })
		);
	}

	test('ahora abre la búsqueda global', async () => {
		barraDelNavegador();
		const busqueda = useGlobalSearchStore();
		expect(busqueda.isOpen).toBe(false);

		expect(await apretarElAtajo()).toBe(true);

		expect(busqueda.isOpen).toBe(true);
	});

	test('y la vuelve a cerrar', async () => {
		// Es `toggle`, no `open`: la etiqueta del atajo dice «mostrar/ocultar».
		barraDelNavegador();
		const busqueda = useGlobalSearchStore();

		await apretarElAtajo();
		await apretarElAtajo();

		expect(busqueda.isOpen).toBe(false);
	});
});
