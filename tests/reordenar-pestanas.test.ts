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
		vista.unmount();

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
		vista.unmount();

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

describe('componente TabBarComponent (integración)', () => {
	let vista: ReturnType<typeof mount>;

	afterEach(() => {
		vista?.unmount();
	});

	test('renderiza la barra con las pestañas del store', async () => {
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })]];
		const { vista: v } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		expect(tabBar.exists()).toBe(true);
		expect(tabBar.props('tabs').length).toBe(2);
		expect(tabBar.props('tabs')[0].label).toBe('Carpeta');
		vista.unmount();
	});

	test('emite select al hacer click en una pestaña', async () => {
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })]];
		const { vista: v, store } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		const pestanas = tabBar.props('tabs');
		tabBar.vm.$emit('select', pestanas[1].id);
		await nextTick();

		expect(store.currentWorkspace?.currentTabGroupIndex).toBe(1);
		vista.unmount();
	});

	test('emite close al cerrar una pestaña', async () => {
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })]];
		const { vista: v, store } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		const pestanas = tabBar.props('tabs');
		tabBar.vm.$emit('close', pestanas[0].id);
		await nextTick();

		expect(store.currentWorkspace?.tabGroups.length).toBe(1);
		expect(store.currentWorkspace?.tabGroups[0]?.[0]?.id).toBe('b');
		vista.unmount();
	});

	test('emite new al crear pestaña nueva', async () => {
		const grupos = [[unTab({ id: 'a' })]];
		const { vista: v, store } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		const gruposAntes = store.currentWorkspace?.tabGroups.length ?? 0;
		await tabBar.vm.$emit('new');
		// openNewTabGroup es async; esperar a que complete
		await new Promise((r) => setTimeout(r, 50));
		await nextTick();

		expect(store.currentWorkspace?.tabGroups.length).toBe(gruposAntes + 1);
		vista.unmount();
	});

	test('abre el menú contextual y cierra al reabrir con nueva ancla', async () => {
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })]];
		const { vista: v } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		const pestanas = tabBar.props('tabs');

		// Abrir menú en la pestaña 'a'
		tabBar.vm.$emit('menu', { id: pestanas[0].id, x: 10, y: 10 });
		await nextTick();
		await nextTick();

		let menu = document.querySelector('[role="menu"]');
		expect(menu).not.toBeNull();
		expect(menu).toBeTruthy();

		// Reabrir menú en la pestaña 'b' (debe cerrar y reabrir)
		tabBar.vm.$emit('menu', { id: pestanas[1].id, x: 20, y: 20 });
		await nextTick();
		await nextTick();

		menu = document.querySelector('[role="menu"]');
		expect(menu).not.toBeNull();
		expect(menu).toBeTruthy();

		// La ancla debe haberse actualizado
		const ancla = vista.find('.fixed.size-0');
		expect(ancla.attributes('style')).toContain('left: 20px');
		expect(ancla.attributes('style')).toContain('top: 20px');
		vista.unmount();
	});
});

describe('cobertura de funciones internas del TabBarComponent', () => {
	let vista: ReturnType<typeof mount>;

	afterEach(() => {
		vista?.unmount();
	});

	test('elegir con ID inexistente no rompe', async () => {
		const grupos = [[unTab({ id: 'a' })]];
		const { vista: v } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		// ID que no existe
		tabBar.vm.$emit('select', 'id-inexistente');
		await nextTick();
		// No debe lanzar error
		vista.unmount();
	});

	test('cerrar con ID inexistente no rompe', async () => {
		const grupos = [[unTab({ id: 'a' })]];
		const { vista: v } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		tabBar.vm.$emit('close', 'id-inexistente');
		await nextTick();
		// No debe lanzar error, grupo sigue ahí
		const store = useWorkspacesStore();
		expect(store.currentWorkspace?.tabGroups.length).toBe(1);
		vista.unmount();
	});

	test('reordenar con lista vacía no rompe', async () => {
		const grupos = [[unTab({ id: 'a' })]];
		const { vista: v } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		tabBar.vm.$emit('reorder', []);
		await nextTick();
		// No debe lanzar error
		vista.unmount();
	});

	test('cerrarLasDemas vía menú funciona', async () => {
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })], [unTab({ id: 'c' })]];
		const { vista: v, store } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		const pestanas = tabBar.props('tabs');

		// Abrir menú en 'b'
		tabBar.vm.$emit('menu', { id: pestanas[1].id, x: 10, y: 10 });
		await nextTick();
		await nextTick();

		// Emitir select en el primer DropdownMenuItem (cerrar las demás)
		const menuItems = vista.findAllComponents({ name: 'DropdownMenuItem' });
		await menuItems[0].vm.$emit('select');
		await nextTick();

		// Solo 'b' debe quedar
		expect(store.currentWorkspace?.tabGroups.length).toBe(1);
		expect(store.currentWorkspace?.tabGroups[0]?.[0]?.id).toBe('b');
		vista.unmount();
	});

	test('cerrarTodas vía menú funciona', async () => {
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })]];
		const { vista: v, store } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		const pestanas = tabBar.props('tabs');

		tabBar.vm.$emit('menu', { id: pestanas[0].id, x: 10, y: 10 });
		await nextTick();
		await nextTick();

		const menuItems = vista.findAllComponents({ name: 'DropdownMenuItem' });
		await menuItems[1].vm.$emit('select');
		// closeAllTabGroups es async y crea un grupo nuevo; esperar un poco más
		await new Promise((r) => setTimeout(r, 50));
		await nextTick();

		expect(store.currentWorkspace?.tabGroups.length).toBe(1);
		expect(store.currentWorkspace?.tabGroups[0]?.length).toBe(1);
		vista.unmount();
	});

	test('reordenar mantiene el grupo activo correcto', async () => {
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })], [unTab({ id: 'c' })]];
		const { vista: v, store } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		const pestanas = tabBar.props('tabs');

		// Mover 'c' al principio
		tabBar.vm.$emit('reorder', [pestanas[2], pestanas[0], pestanas[1]]);
		await nextTick();

		expect(store.currentWorkspace?.tabGroups.map((g) => g[0]?.id)).toEqual(['c', 'a', 'b']);
		// El grupo activo debe seguir siendo el que estaba activo (índice 0 -> 'a')
		expect(store.currentWorkspace?.currentTabGroupIndex).toBe(1); // 'a' ahora está en índice 1
		vista.unmount();
	});

	test('reordenar con un solo grupo no rompe', async () => {
		const grupos = [[unTab({ id: 'a' })]];
		const { vista: v } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		const pestanas = tabBar.props('tabs');
		tabBar.vm.$emit('reorder', [pestanas[0]]);
		await nextTick();
		// No debe lanzar error
		vista.unmount();
	});

	test('menú se cierra y reabre al cambiar pestaña objetivo', async () => {
		const grupos = [[unTab({ id: 'a' })], [unTab({ id: 'b' })]];
		const { vista: v } = await montarLaBarra(grupos);
		vista = v;

		const tabBar = vista.findComponent(TabBar);
		const pestanas = tabBar.props('tabs');

		// Abrir menú en 'a'
		tabBar.vm.$emit('menu', { id: pestanas[0].id, x: 10, y: 10 });
		await nextTick();
		await nextTick();

		let menu = document.querySelector('[role="menu"]');
		expect(menu).not.toBeNull();
		expect(menu).toBeTruthy();

		// Cambiar a 'b' sin cerrar menú previo
		tabBar.vm.$emit('menu', { id: pestanas[1].id, x: 50, y: 50 });
		await nextTick();
		await nextTick();

		// Menú debe seguir existiendo
		menu = document.querySelector('[role="menu"]');
		expect(menu).not.toBeNull();
		expect(menu).toBeTruthy();

		// Ancla actualizada
		const ancla = vista.find('.fixed.size-0');
		expect(ancla.attributes('style')).toContain('left: 50px');
		expect(ancla.attributes('style')).toContain('top: 50px');
		vista.unmount();
	});
});
