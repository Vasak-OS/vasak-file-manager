/**
 * La cuenta que reordena las pestañas cuando se suelta una arrastrada.
 *
 * La librería (`@vasakgroup/vue-libvasak`) usa arrastre nativo del navegador y
 * emite la lista nueva con el evento `reorder`. Lo que se prueba acá es que
 * esa lista se traduce de vuelta a grupos de pestañas —lo que el store entiende—
 * y que el orden se guarda correctamente.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { TabBar } from '@vasakgroup/vue-libvasak';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import TabBarComponent from '@/components/tab/TabBarComponent.vue';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { Tab } from '@/types/workspaces';
import { olvidarTodo } from './dobles';

function unTab(cambios: Partial<Tab> = {}): Tab {
	return {
		id: 'uno',
		name: 'Carpeta',
		path: '/home/pato',
		type: 'directory',
		paneWidth: 100,
		filterQuery: '',
		...cambios,
	};
}

/** Monta la barra de pestañas con los grupos que se le pongan al store. */
async function montarLaBarra(grupos: Tab[][]) {
	const pinia = createPinia();
	setActivePinia(pinia);
	const store = useWorkspacesStore();
	const espacio = store.currentWorkspace;
	if (espacio) {
		espacio.tabGroups = grupos;
		espacio.currentTabGroupIndex = 0;
	}
	const vista = mount(TabBarComponent, {
		attachTo: document.body,
		global: { plugins: [pinia] },
	});
	await nextTick();
	return { vista, store };
}

beforeEach(() => {
	olvidarTodo();
});

afterEach(() => {
	// Limpieza manual en lugar de enableAutoUnmount (sólo se puede llamar una vez por proceso)
});

describe('al reordenar pestañas', () => {
	test('guarda los grupos en el orden nuevo', async () => {
		// La librería emite la lista de pestañas; acá se traduce de vuelta a
		// grupos, que es lo que el store entiende.
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })], [unTab({ id: 'c' })]];
		const { vista, store } = await montarLaBarra(grupos);

		const pestanas = vista.findComponent(TabBar).props('tabs');
		vista.findComponent(TabBar).vm.$emit('reorder', [pestanas[2], pestanas[0], pestanas[1]]);
		await nextTick();

		expect(store.currentWorkspace?.tabGroups.map((grupo) => grupo[0]?.id)).toEqual(['c', 'a', 'b']);
	});

	test('un grupo partido en dos se mueve entero', async () => {
		// Cada grupo puede tener varias pestañas (vista dividida). El reordenamiento
		// opera a nivel de grupo: se mueve el grupo completo, no las pestañas
		// individuales.
		const grupos = [[unTab({ id: 'a' }), unTab({ id: 'a2' })], [unTab({ id: 'b' })]];
		const { vista, store } = await montarLaBarra(grupos);

		const pestanas = vista.findComponent(TabBar).props('tabs');
		// Invierte el orden de los dos grupos
		vista.findComponent(TabBar).vm.$emit('reorder', [pestanas[1], pestanas[0]]);
		await nextTick();

		expect(store.currentWorkspace?.tabGroups.map((grupo) => grupo[0]?.id)).toEqual(['b', 'a']);
		// El grupo movido conserva sus pestañas internas
		expect(store.currentWorkspace?.tabGroups[0]?.length).toBe(1);
		expect(store.currentWorkspace?.tabGroups[1]?.length).toBe(2);
	});
});

describe('acciones del menú de pestaña (lógica del store)', () => {
	test('closeOtherTabGroups cierra los otros grupos', async () => {
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })], [unTab({ id: 'c' })]];
		const { store } = await montarLaBarra(grupos);

		// Simulamos mantener el grupo 'b'
		await store.closeOtherTabGroups(grupos[1]);
		await nextTick();

		expect(store.currentWorkspace?.tabGroups.length).toBe(1);
		expect(store.currentWorkspace?.tabGroups[0]?.[0]?.id).toBe('b');
	});

	test('closeAllTabGroups deja un grupo vacío', async () => {
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })]];
		const { store } = await montarLaBarra(grupos);

		await store.closeAllTabGroups();
		await nextTick();

		expect(store.currentWorkspace?.tabGroups.length).toBe(1);
		expect(store.currentWorkspace?.tabGroups[0]?.length).toBe(1);
		// El grupo nuevo tiene un ID distinto
		expect(store.currentWorkspace?.tabGroups[0]?.[0]?.id).not.toBe('a');
		expect(store.currentWorkspace?.tabGroups[0]?.[0]?.id).not.toBe('b');
	});
});
