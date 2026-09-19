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

const entrada = (parcial: Partial<DirEntry> = {}): DirEntry =>
	({ name: 'archivo.txt', path: '/home/pato/archivo.txt', is_dir: false, ...parcial }) as DirEntry;

function lasOpciones(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

function elMenu(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[role="menu"]');
}

function abrirElMenu() {
	const disparador = document.querySelector<HTMLElement>('[aria-haspopup="menu"]');
	disparador?.click();
}

/**
 * La barra del portapapeles con algo adentro.
 *
 * Con `move` y el destino igual al origen, «pegar» queda apagado, que es el
 * caso que importa: era el que se disparaba igual.
 */
async function montarElPortapapeles(tipo: 'copy' | 'move', destino: string) {
	const pinia = createPinia();
	setActivePinia(pinia);
	const clipboard = useClipboardStore();
	clipboard.setClipboard(tipo, [entrada()]);

	const vista = mount(ClipboardToolbarComponent, {
		attachTo: document.body,
		props: { currentPath: destino },
		global: { plugins: [pinia] },
	});
	await nextTick();
	return vista;
}

beforeEach(() => {
	olvidarTodo();
	setActivePinia(createPinia());
});

describe('el menú del portapapeles', () => {
	test('se anuncia como menú y sus opciones como opciones', async () => {
		await montarElPortapapeles('copy', '/otro');
		abrirElMenu();
		await nextTick();
		await nextTick();

		expect(elMenu()).not.toBeNull();
		expect(elMenu()?.getAttribute('aria-orientation')).toBe('vertical');
		expect(lasOpciones().length).toBeGreaterThan(1);
		for (const opcion of lasOpciones()) {
			expect(opcion.getAttribute('tabindex')).toBe('0');
		}
	});

	test('el disparador dice que abre un menú', async () => {
		await montarElPortapapeles('copy', '/otro');

		const disparador = document.querySelector('[aria-haspopup="menu"]');
		// Sobre el botón, no sobre un envoltorio: es lo que recibe el foco y
		// por lo tanto lo único que se anuncia.
		expect(disparador?.tagName).toBe('BUTTON');
		expect(disparador?.getAttribute('aria-expanded')).toBe('false');

		abrirElMenu();
		await nextTick();
		expect(disparador?.getAttribute('aria-expanded')).toBe('true');
	});

	test('«pegar» apagado ya no pega', async () => {
		// Estaba roto y no se veía: el `@click` del ítem era el evento nativo
		// del `div`, que no pasa por donde se comprueba `disabled`. La opción
		// se dibujaba gris y pegaba igual.
		const vista = await montarElPortapapeles('move', '/home/pato');
		abrirElMenu();
		await nextTick();

		const pegar = lasOpciones().find((opcion) => opcion.getAttribute('aria-disabled') === 'true');
		expect(pegar).toBeDefined();

		pegar?.click();
		await nextTick();

		expect(vista.emitted('paste')).toBeUndefined();
	});

	test('la clase del menú llega al menú', async () => {
		// `class` se declaraba como propiedad y se leía de `$attrs`, donde ya no
		// estaba: todo lo que se le pasara se descartaba en silencio. Los anchos
		// y el `[&_[role=menuitem]]` de los cuatro menús nunca se aplicaron.
		await montarElPortapapeles('copy', '/otro');
		abrirElMenu();
		await nextTick();

		expect(elMenu()?.className).toContain('clipboard-toolbar__dropdown');
	});
});

describe('el menú de acciones sobre una selección', () => {
	test('una acción se emite una vez, no dos', async () => {
		// Cada opción llevaba `@select` y `@click` con la misma llamada: uno era
		// el evento del componente y el otro el nativo del `div`, así que un
		// clic hacía la acción dos veces. Ahora `click` también es del
		// componente —llega con el teclado— y con los dos enlazados se emitía
		// igual de doble.
		const vista = mount(ActionMenuComponent, {
			attachTo: document.body,
			props: {
				selectedEntries: [entrada()],
				menuItemComponent: DropdownMenuItem,
				menuSeparatorComponent: DropdownMenuSeparator,
			},
		});
		await nextTick();

		const abrirCon = lasOpciones().find((opcion) =>
			opcion.textContent?.includes('fileBrowser.actions.openWith')
		);
		expect(abrirCon).toBeDefined();
		abrirCon?.click();
		await nextTick();

		expect(vista.emitted('action')).toEqual([['open-with']]);
	});
});
