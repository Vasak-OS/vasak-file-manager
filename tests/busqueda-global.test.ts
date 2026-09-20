/**
 * Cómo se abre la búsqueda global.
 *
 * No se abría. `GlobalSearchView` se monta en la barra del navegador con
 * `v-show="globalSearchStore.isOpen"`, la ventana le pasa ese estado a los
 * botones de la barra —que lo usan para apagar el de dividir, porque dividir
 * con la búsqueda abierta no tiene sentido— y el store trae `open()`, `close()`
 * y `toggle()`. Lo único que faltaba era que algo los llamara: ningún botón,
 * ningún atajo. La mitad del cableado estaba puesta y la vista no se mostraba
 * nunca.
 *
 * Acá se prueban las dos puntas: que el botón exista y avise, y que la ventana
 * conecte ese aviso con el store. Por separado, porque son los dos lugares
 * donde se puede cortar: un botón que no emite, o un emit que nadie escucha
 * —y este último no da ningún error—.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import NavigatorToolbarActionsComponent from '@/components/navigator/NavigatorToolbarActionsComponent.vue';
import WindowAppLayout from '@/layouts/WindowAppLayout.vue';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { olvidarTodo, responder } from './dobles';

let vista: VueWrapper | null = null;

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	// El estado del índice se pide al abrir; sin respuesta el `open()` revienta
	// y la prueba diría que no abrió por el motivo equivocado.
	responder('get_index_status', {});
	responder('get_active_calculations', []);
});

afterEach(() => {
	vista?.unmount();
	vista = null;
});

/** El botón cuyo nombre accesible es ése. */
function botonDe(donde: VueWrapper, etiqueta: string) {
	return donde.findAll('button').find((boton) => boton.attributes('aria-label') === etiqueta);
}

describe('el botón de la barra', () => {
	function barra(abierta = false) {
		vista = mount(NavigatorToolbarActionsComponent, {
			props: { isSplitView: false, showInfoPanel: false, isGlobalSearchOpen: abierta },
		});
		return vista;
	}

	test('existe, y avisa al apretarlo', async () => {
		const botones = barra();

		// `globalSearch.globalSearch` es la clave; el doble de `t()` devuelve la
		// clave, así que es lo que sale como nombre accesible.
		const boton = botonDe(botones, 'globalSearch.globalSearch');
		expect(boton).toBeDefined();

		await boton?.trigger('click');

		expect(botones.emitted('toggle-global-search')).toHaveLength(1);
	});

	test('y no es el de la búsqueda rápida de cada panel', () => {
		// Son dos cosas distintas y estaban a un icono de confundirse: la rápida
		// filtra la carpeta que se está mirando, ésta busca en todas las
		// unidades. La de cada panel usa `system-search`; ésta, `search`, que es
		// el mismo que la propia vista dibuja en su campo.
		const fuente = Bun.file(
			new URL('../src/components/navigator/NavigatorToolbarActionsComponent.vue', import.meta.url)
		);

		return fuente.text().then((texto) => {
			expect(texto).toContain("getSymbolSource('search')");
			expect(texto).not.toContain("getSymbolSource('system-search')");
		});
	});

	test('se marca como activo mientras la búsqueda está abierta', async () => {
		// Sin esto no hay forma de saber, mirando la barra, que lo que tapa el
		// contenido es la búsqueda.
		const boton = botonDe(barra(true), 'globalSearch.globalSearch');

		expect(boton?.classes()).toContain('bg-primary');
	});
});

describe('la ventana', () => {
	function abrirLaVentana() {
		vista = mount(WindowAppLayout, {
			global: {
				stubs: {
					SidebarComponent: true,
					NavigatorBarComponent: true,
					ContentInformation: true,
				},
			},
		});
		return vista;
	}

	test('conecta el aviso del botón con el store', async () => {
		const ventana = abrirLaVentana();
		const store = useGlobalSearchStore();
		expect(store.isOpen).toBe(false);

		const acciones = ventana.findComponent(NavigatorToolbarActionsComponent);
		expect(acciones.exists()).toBe(true);
		acciones.vm.$emit('toggle-global-search');
		await ventana.vm.$nextTick();

		expect(store.isOpen).toBe(true);
	});

	test('y el mismo botón la cierra', async () => {
		const ventana = abrirLaVentana();
		const store = useGlobalSearchStore();
		const acciones = ventana.findComponent(NavigatorToolbarActionsComponent);

		acciones.vm.$emit('toggle-global-search');
		await ventana.vm.$nextTick();
		acciones.vm.$emit('toggle-global-search');
		await ventana.vm.$nextTick();

		expect(store.isOpen).toBe(false);
	});
});

describe('salir con Escape', () => {
	/**
	 * La barra del navegador montada, que es quien registra el manejador.
	 *
	 * Se le apagan los hijos pesados: lo que se prueba es el manejador, no lo
	 * que dibujan.
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

	/** Un Escape, por el mismo camino que lo recibe la aplicación. */
	async function apretarEscape() {
		return await useShortcutsStore().handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
	}

	test('cierra la búsqueda global', async () => {
		// El panel tapa el contenido entero, y hasta acá la única salida era la
		// cruz de adentro.
		barraDelNavegador();
		const busqueda = useGlobalSearchStore();
		await busqueda.open();
		expect(busqueda.isOpen).toBe(true);

		expect(await apretarEscape()).toBe(true);

		expect(busqueda.isOpen).toBe(false);
	});

	test('y con la búsqueda cerrada no se queda con la tecla', async () => {
		// Devolver `true` sin hacer nada le corta el paso a lo que venga
		// después, que es cómo se rompe un manejador de Escape.
		barraDelNavegador();

		expect(await apretarEscape()).toBe(false);
	});
});
