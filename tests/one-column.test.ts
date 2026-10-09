/**
 * Una columna por vez en una ventana angosta, y el formato de siempre en una
 * ancha.
 *
 * Lo decide el ancho de la ventana (`use-window-columns.ts`), medido con un
 * `ResizeObserver` sobre la raíz del marco. Acá se comprueba el corte, que la
 * ventana montada esconda y muestre lo que corresponde en cada ancho, y que de
 * la información se vuelva a los archivos.
 *
 * happy-dom no mide nada, así que el observador se reemplaza por uno que
 * informa el ancho que pide cada prueba. Que eso se vea como se dice lo
 * muestran las capturas del banco con Chrome (`apps-shots/vasak-file-manager`).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick, ref } from 'vue';
import {
	COMPACT_MAX_WIDTH,
	columnsFor,
	createWindowColumns,
	ONE_COLUMN_MAX_WIDTH,
	useWindowColumns,
} from '@/composables/use-window-columns';
import { olvidarTodo } from './dobles';

let reportedWidth = 1200;
const observers = new Set<FakeResizeObserver>();
const realResizeObserver = globalThis.ResizeObserver;

class FakeResizeObserver {
	private targets: Element[] = [];
	constructor(private readonly callback: ResizeObserverCallback) {
		observers.add(this);
	}
	observe(target: Element) {
		this.targets.push(target);
		this.report();
	}
	report() {
		this.callback(
			this.targets.map(
				(target) =>
					({ target, contentRect: { width: reportedWidth } }) as unknown as ResizeObserverEntry
			),
			this as unknown as ResizeObserver
		);
	}
	unobserve() {}
	disconnect() {
		observers.delete(this);
	}
}

async function resizeTo(width: number) {
	reportedWidth = width;
	for (const observer of observers) observer.report();
	await nextTick();
}

beforeEach(() => {
	olvidarTodo();
	setActivePinia(createPinia());
	globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
	globalThis.ResizeObserver = realResizeObserver;
	observers.clear();
});

describe('el corte', () => {
	test('por debajo de 768 píxeles entra una columna, y por debajo de 480 la barra va encima', () => {
		expect(ONE_COLUMN_MAX_WIDTH).toBe(768);
		expect(COMPACT_MAX_WIDTH).toBe(480);
		expect(columnsFor(1200)).toEqual({ isOneColumn: false, isCompact: false });
		expect(columnsFor(768)).toEqual({ isOneColumn: false, isCompact: false });
		expect(columnsFor(600)).toEqual({ isOneColumn: true, isCompact: false });
		expect(columnsFor(360)).toEqual({ isOneColumn: true, isCompact: true });
		expect(columnsFor(240)).toEqual({ isOneColumn: true, isCompact: true });
	});

	test('sin medida todavía, el formato de siempre', () => {
		// Sin esto, la primera pintura —antes de que el observador conteste—
		// saldría en una columna en cualquier ventana.
		expect(columnsFor(0)).toEqual({ isOneColumn: false, isCompact: false });
	});

	test('fuera de la ventana, un componente suelto ve el formato de siempre', () => {
		const Probe = defineComponent({
			setup() {
				const columns = useWindowColumns();
				return () => h('span', String(columns.isOneColumn.value));
			},
		});

		expect(mount(Probe).text()).toBe('false');
	});
});

describe('al cambiar de ancho', () => {
	function mountMeasured() {
		let state: ReturnType<typeof createWindowColumns> | null = null;
		const Root = defineComponent({
			setup() {
				const root = ref<HTMLElement | null>(null);
				state = createWindowColumns(root);
				return () => h('div', { ref: root });
			},
		});
		const view = mount(Root, { attachTo: document.body });
		return { view, state: () => state as unknown as ReturnType<typeof createWindowColumns> };
	}

	test('sigue el ancho que informa el observador', async () => {
		const { view, state } = mountMeasured();
		await resizeTo(1200);
		expect(state().isOneColumn.value).toBe(false);

		await resizeTo(600);
		expect(state().isOneColumn.value).toBe(true);
		expect(state().isCompact.value).toBe(false);

		await resizeTo(300);
		expect(state().isCompact.value).toBe(true);
		view.unmount();
	});

	test('al volver a una ventana ancha no queda nada abierto encima', async () => {
		const { view, state } = mountMeasured();
		await resizeTo(300);
		state().column.value = 'info';
		state().isSidebarOpen.value = true;

		await resizeTo(1200);

		expect(state().column.value).toBe('files');
		expect(state().isSidebarOpen.value).toBe(false);
		view.unmount();
	});
});

describe('la ventana montada', () => {
	async function mountWindow(width: number) {
		reportedWidth = width;
		const { default: WindowAppLayout } = await import('@/layouts/WindowAppLayout.vue');
		const view = mount(WindowAppLayout, {
			attachTo: document.body,
			global: {
				stubs: {
					NavigatorBarComponent: { template: '<div data-files />' },
					ContentInformation: { props: ['fill'], template: '<div data-info :data-fill="fill" />' },
					SidebarComponent: { template: '<aside data-sidebar />' },
					TabBarComponent: true,
					NavigatorToolbarActionsComponent: {
						emits: ['toggle-info-panel', 'toggle-sidebar'],
						template:
							'<div><button data-toggle-info @click="$emit(\'toggle-info-panel\')" /><button data-toggle-sidebar @click="$emit(\'toggle-sidebar\')" /></div>',
					},
				},
			},
		});
		await nextTick();
		await nextTick();
		return view;
	}

	const shown = (element: Element | null) =>
		element !== null && (element as HTMLElement).style.display !== 'none';

	test('a 1200 píxeles, las tres columnas como siempre', async () => {
		const view = await mountWindow(1200);

		expect(shown(view.find('[data-sidebar]').element.parentElement)).toBe(true);
		expect(shown(view.find('[data-files]').element.parentElement)).toBe(true);
		expect(view.find('[data-info]').exists()).toBe(true);
		expect(view.find('[data-info]').attributes('data-fill')).toBe('false');
		view.unmount();
	});

	for (const width of [600, 360, 240]) {
		test(`a ${width} píxeles, los archivos solos y la información en su lugar al pedirla`, async () => {
			const view = await mountWindow(width);

			expect(shown(view.find('[data-files]').element.parentElement)).toBe(true);
			expect(view.find('[data-info]').exists()).toBe(false);

			await view.find('[data-toggle-info]').trigger('click');
			await nextTick();

			expect(shown(view.find('[data-files]').element.parentElement)).toBe(false);
			expect(view.find('[data-info]').attributes('data-fill')).toBe('true');

			// Y se vuelve con «Volver a los archivos».
			const back = view.findAll('button').find((button) => button.text() === 'window.backToFiles');
			expect(back).toBeDefined();
			await back?.trigger('click');
			await nextTick();

			expect(shown(view.find('[data-files]').element.parentElement)).toBe(true);
			expect(view.find('[data-info]').exists()).toBe(false);
			view.unmount();
		});
	}

	test('compacta, la barra lateral se abre encima y el velo la cierra', async () => {
		const view = await mountWindow(360);
		const sidebar = () => view.find('[data-sidebar]').element.parentElement;

		expect(shown(sidebar())).toBe(false);

		await view.find('[data-toggle-sidebar]').trigger('click');
		await nextTick();
		expect(shown(sidebar())).toBe(true);
		expect(sidebar()?.className).toContain('absolute');

		const scrim = view.find('button[aria-label="window.closeSidebar"]');
		expect(scrim.exists()).toBe(true);
		await scrim.trigger('click');
		await nextTick();
		expect(shown(sidebar())).toBe(false);
		view.unmount();
	});

	test('a 600 píxeles la barra lateral sigue al lado, plegada por la librería', async () => {
		const view = await mountWindow(600);

		expect(shown(view.find('[data-sidebar]').element.parentElement)).toBe(true);
		expect(view.find('button[aria-label="window.closeSidebar"]').exists()).toBe(false);
		view.unmount();
	});
});
