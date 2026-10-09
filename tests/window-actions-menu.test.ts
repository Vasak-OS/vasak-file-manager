/**
 * El menú «más» de la barra de la ventana, el de una columna por vez.
 *
 * Con la ventana angosta los cuatro botones de la barra pasan a un menú, y en
 * compacto el menú suma «Lugares», el cajón de la barra lateral. Lo que se
 * comprueba es que cada opción haga lo mismo que su botón.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import NavigatorToolbarActionsComponent from '@/components/navigator/NavigatorToolbarActionsComponent.vue';
import { WINDOW_COLUMNS_KEY } from '@/composables/use-window-columns';
import { olvidarTodo } from './dobles';

// A mano y no con `enableAutoUnmount`: ése se puede llamar una sola vez por
// proceso, y otro archivo ya lo usa (en CI corren todos juntos).
const mounted: VueWrapper[] = [];
afterEach(() => {
	for (const view of mounted.splice(0)) view.unmount();
});

beforeEach(() => {
	olvidarTodo();
	setActivePinia(createPinia());
});

function mountBar(width: number) {
	const columns = {
		width: ref(width),
		isOneColumn: ref(width < 768),
		isCompact: ref(width < 480),
		column: ref<'files' | 'info'>('files'),
		isSidebarOpen: ref(false),
	};
	const view = mount(NavigatorToolbarActionsComponent, {
		attachTo: document.body,
		props: { isSplitView: false, showInfoPanel: false, isGlobalSearchOpen: false },
		global: { provide: { [WINDOW_COLUMNS_KEY as symbol]: columns } },
	});
	mounted.push(view);
	return view;
}

async function choose(label: string) {
	document.querySelector<HTMLElement>('button[aria-label="window.moreActions"]')?.click();
	await nextTick();
	await nextTick();
	const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((element) =>
		element.textContent?.includes(label)
	);
	expect(item).toBeDefined();
	item?.click();
	await nextTick();
}

describe('el menú «más»', () => {
	test('en el ancho de siempre no está: van los cuatro botones', () => {
		const view = mountBar(1200);

		expect(view.find('button[aria-label="window.moreActions"]').exists()).toBe(false);
		expect(view.find('button[aria-label="splitView"]').exists()).toBe(true);
	});

	test('en una columna, cada opción hace lo de su botón', async () => {
		const view = mountBar(600);

		await choose('splitView');
		expect(view.emitted('toggle-split-view')).toHaveLength(1);

		await choose('settings.infoPanel.title');
		expect(view.emitted('toggle-info-panel')).toHaveLength(1);
	});

	test('en compacto suma «Lugares»', async () => {
		const view = mountBar(360);

		await choose('window.places');
		expect(view.emitted('toggle-sidebar')).toHaveLength(1);
	});
});
