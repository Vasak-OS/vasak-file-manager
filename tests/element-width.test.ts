/**
 * El ancho de un elemento (`useElementWidth`), con el que las barras deciden
 * si sus botones llevan texto o van a un menú.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { useElementWidth } from '@/composables/use-element-width';

const realResizeObserver = globalThis.ResizeObserver;
let observers: Array<{ report: (width: number) => void; disconnected: boolean }> = [];

class FakeResizeObserver {
	disconnected = false;
	private target: Element | null = null;
	constructor(private readonly callback: ResizeObserverCallback) {
		observers.push(this);
	}
	observe(target: Element) {
		this.target = target;
	}
	report(width: number) {
		this.callback(
			[{ target: this.target, contentRect: { width } } as unknown as ResizeObserverEntry],
			this as unknown as ResizeObserver
		);
	}
	unobserve() {}
	disconnect() {
		this.disconnected = true;
	}
}

afterEach(() => {
	globalThis.ResizeObserver = realResizeObserver;
	observers = [];
});

function mountProbe(shown = true) {
	const visible = ref(shown);
	let width: ReturnType<typeof useElementWidth> | null = null;
	const Probe = defineComponent({
		setup() {
			const element = ref<HTMLElement | null>(null);
			width = useElementWidth(element);
			return () => (visible.value ? h('div', { ref: element }) : h('span'));
		},
	});
	const view = mount(Probe);
	return { view, visible, width: () => (width as unknown as { value: number }).value };
}

describe('el ancho de un elemento', () => {
	test('sin medida todavía vale infinito: se dibuja el formato ancho', () => {
		globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
		const { width, view } = mountProbe();

		expect(width()).toBe(Number.POSITIVE_INFINITY);
		view.unmount();
	});

	test('sigue lo que informa el observador', async () => {
		globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
		const { width, view } = mountProbe();
		await nextTick();

		observers[0]?.report(320);
		expect(width()).toBe(320);
		observers[0]?.report(640);
		expect(width()).toBe(640);
		view.unmount();
	});

	test('suelta el observador cuando el elemento se va y al desmontar', async () => {
		globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
		const { view, visible } = mountProbe();
		await nextTick();
		const first = observers[0];

		visible.value = false;
		await nextTick();
		await nextTick();
		expect(first?.disconnected).toBe(true);

		visible.value = true;
		await nextTick();
		await nextTick();
		view.unmount();
		expect(observers.at(-1)?.disconnected).toBe(true);
	});

	test('sin `ResizeObserver` no rompe: se queda en el formato ancho', async () => {
		// biome-ignore lint/suspicious/noExplicitAny: se borra a propósito para la prueba
		(globalThis as any).ResizeObserver = undefined;
		const { width, view } = mountProbe();
		await nextTick();

		expect(width()).toBe(Number.POSITIVE_INFINITY);
		view.unmount();
	});
});
