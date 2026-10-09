/**
 * Los menús de las barras, que hasta ahora no eran menús.
 *
 * Los cuatro —la barra de direcciones, la de herramientas, la de estado y la
 * del portapapeles— dibujaban un `div` teletransportado al `body` con un `div`
 * por opción: sin `role`, sin `tabindex` y sin teclado. Ahora son los de
 * `@vasakgroup/vue-libvasak`, y lo que se comprueba acá es lo que cambia para
 * quien usa la aplicación: que se anuncien como menú, que el teclado llegue, y
 * las dos cosas que el desplegable de la casa hacía mal sin que se notara.
 *
 * El contenido vive en el `body` y no en el envoltorio de la prueba, así que se
 * busca en el documento. Que eso se **pueda** buscar por `role` es parte de lo
 * que se arregló.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DropdownMenuItem, DropdownMenuSeparator } from '@vasakgroup/vue-libvasak';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ActionMenuComponent from '../src/components/menu/ActionMenuComponent.vue';
import ClipboardToolbarComponent from '../src/components/navigator/ClipboardToolbarComponent.vue';
import { useClipboardStore } from '../src/stores/runtime/clipboard';
import type { DirEntry } from '../src/types/dir-entry';
import { olvidarTodo } from './dobles';

// El menú se teletransporta al `body`: sin desmontar, el de una prueba sigue
// puesto en la siguiente y `[role="menuitem"]` devuelve las opciones de las dos.
enableAutoUnmount(afterEach);

/**
 * Una barra angosta.
 *
 * El menú de la barra del portapapeles es su forma angosta: por debajo de 400
 * píxeles los botones pasan a él. Lo decide un `ResizeObserver` sobre la barra,
 * y happy-dom no mide nada, así que se le hace decir 300.
 */
const realResizeObserver = globalThis.ResizeObserver;
class NarrowResizeObserver {
	constructor(private readonly callback: ResizeObserverCallback) {}
	observe(element: Element) {
		this.callback(
			[{ contentRect: { width: 300 }, target: element } as unknown as ResizeObserverEntry],
			this as unknown as ResizeObserver
		);
	}
	unobserve() {}
	disconnect() {}
}

const entry = (partial: Partial<DirEntry> = {}): DirEntry =>
	({ name: 'archivo.txt', path: '/home/pato/archivo.txt', is_dir: false, ...partial }) as DirEntry;

function menuItems(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

function theMenu(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[role="menu"]');
}

function openTheMenu() {
	const trigger = document.querySelector<HTMLElement>('[aria-haspopup="menu"]');
	trigger?.click();
}

/**
 * La barra del portapapeles con algo adentro.
 *
 * Con `move` y el target igual al origen, «paste» queda apagado, que es el
 * caso que importa: era el que se disparaba igual.
 */
async function mountClipboardBar(kind: 'copy' | 'move', target: string) {
	const pinia = createPinia();
	setActivePinia(pinia);
	const clipboard = useClipboardStore();
	clipboard.setClipboard(kind, [entry()]);

	const view = mount(ClipboardToolbarComponent, {
		attachTo: document.body,
		props: { currentPath: target },
		global: { plugins: [pinia] },
	});
	await nextTick();
	await nextTick();
	return view;
}

beforeEach(() => {
	olvidarTodo();
	setActivePinia(createPinia());
	globalThis.ResizeObserver = NarrowResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
	globalThis.ResizeObserver = realResizeObserver;
});

describe('el menú del portapapeles', () => {
	test('se anuncia como menú y sus opciones como opciones', async () => {
		await mountClipboardBar('copy', '/otro');
		openTheMenu();
		await nextTick();
		await nextTick();

		expect(theMenu()).not.toBeNull();
		expect(theMenu()?.getAttribute('aria-orientation')).toBe('vertical');
		expect(menuItems().length).toBeGreaterThan(1);
		for (const item of menuItems()) {
			expect(item.getAttribute('tabindex')).toBe('0');
		}
	});

	test('el trigger dice que abre un menú', async () => {
		await mountClipboardBar('copy', '/otro');

		const trigger = document.querySelector('[aria-haspopup="menu"]');
		// Sobre el botón, no sobre un envoltorio: es lo que recibe el foco y
		// por lo tanto lo único que se anuncia.
		expect(trigger?.tagName).toBe('BUTTON');
		expect(trigger?.getAttribute('aria-expanded')).toBe('false');

		openTheMenu();
		await nextTick();
		expect(trigger?.getAttribute('aria-expanded')).toBe('true');
	});

	test('«paste» apagado ya no pega', async () => {
		// Estaba roto y no se veía: el `@click` del ítem era el evento nativo
		// del `div`, que no pasa por donde se comprueba `disabled`. La opción
		// se dibujaba gris y pegaba igual.
		const view = await mountClipboardBar('move', '/home/pato');
		openTheMenu();
		await nextTick();

		const paste = menuItems().find((item) => item.getAttribute('aria-disabled') === 'true');
		expect(paste).toBeDefined();

		paste?.click();
		await nextTick();

		expect(view.emitted('paste')).toBeUndefined();
	});

	test('la clase del menú llega al menú', async () => {
		// `class` se declaraba como propiedad y se leía de `$attrs`, donde ya no
		// estaba: todo lo que se le pasara se descartaba en silencio. Los anchos
		// y el `[&_[role=menuitem]]` de los cuatro menús nunca se aplicaron.
		await mountClipboardBar('copy', '/otro');
		openTheMenu();
		await nextTick();

		expect(theMenu()?.className).toContain('min-w-45');
	});
});

describe('el menú de acciones sobre una selección', () => {
	test('una acción se emite una vez, no dos', async () => {
		// Cada opción llevaba `@select` y `@click` con la misma llamada: uno era
		// el evento del componente y el otro el nativo del `div`, así que un
		// clic hacía la acción dos veces. Ahora `click` también es del
		// componente —llega con el teclado— y con los dos enlazados se emitía
		// igual de doble.
		const view = mount(ActionMenuComponent, {
			attachTo: document.body,
			props: {
				selectedEntries: [entry()],
				menuItemComponent: DropdownMenuItem,
				menuSeparatorComponent: DropdownMenuSeparator,
			},
		});
		await nextTick();

		const abrirCon = menuItems().find((item) =>
			item.textContent?.includes('fileBrowser.actions.openWith')
		);
		expect(abrirCon).toBeDefined();
		abrirCon?.click();
		await nextTick();

		expect(view.emitted('action')).toEqual([['open-with']]);
	});
});
