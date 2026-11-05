/**
 * Paneles inertes bajo un overlay (#175): con la búsqueda global, la papelera o
 * los ajustes tapando los paneles, el grupo no debe recibir foco de teclado ni
 * llegar a los lectores de pantalla.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import ResizablePanelGroup from '@/components/ui/ResizablePanelGroup.vue';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useTrashStore } from '@/stores/runtime/trash';
import { useUserSettingsStore } from '@/stores/storage/user-settings';
import { olvidarTodo, responder } from './dobles';

const montadas: VueWrapper[] = [];

beforeEach(() => {
	olvidarTodo();
	responder('list_trash', []);
	responder('get_active_calculations', []);
	responder('get_system_drives', []);
	responder('list_cloud_drives', []);
});

afterEach(() => {
	while (montadas.length) montadas.pop()?.unmount();
});

describe('ResizablePanelGroup', () => {
	const grupo = (props: Record<string, unknown> = {}) => {
		const w = mount(ResizablePanelGroup, { props });
		montadas.push(w);
		return w.find('[data-resizable-panel-group]').element;
	};

	test('con inert el grupo lleva el atributo inert', () => {
		expect(grupo({ inert: true }).hasAttribute('inert')).toBe(true);
	});

	test('con inert en falso el grupo no es inerte', () => {
		expect(grupo({ inert: false }).hasAttribute('inert')).toBe(false);
	});

	test('sin la prop el grupo no es inerte', () => {
		expect(grupo().hasAttribute('inert')).toBe(false);
	});
});

describe('los paneles del navegador bajo un overlay', () => {
	function barra() {
		const pinia = createPinia();
		setActivePinia(pinia);
		const vista = mount(NavigatorBarComponent, {
			global: {
				plugins: [pinia],
				stubs: {
					FileBrowserComponent: true,
					GlobalSearchView: true,
					ClipboardToolbarComponent: true,
				},
			},
		});
		montadas.push(vista);
		const inerte = () =>
			vista
				.find('.navigator-page__panes[data-resizable-panel-group]')
				.element.hasAttribute('inert');
		return { inerte };
	}

	const overlays = [
		['la búsqueda global', () => useGlobalSearchStore()],
		['la papelera', () => useTrashStore()],
		['los ajustes', () => useUserSettingsStore()],
	] as const;

	test('con los tres overlays cerrados los paneles no son inertes', () => {
		expect(barra().inerte()).toBe(false);
	});

	for (const [nombre, tienda] of overlays) {
		test(`abrir ${nombre} vuelve inertes los paneles y cerrarla los libera`, async () => {
			const { inerte } = barra();
			const store = tienda();
			store.isOpen = true;
			await nextTick();
			expect(inerte()).toBe(true);
			store.isOpen = false;
			await nextTick();
			expect(inerte()).toBe(false);
		});
	}
});
