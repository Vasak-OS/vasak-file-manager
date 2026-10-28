/**
 * El menú al soltar (#148): arrastrar con el botón derecho y elegir qué hacer.
 *
 * Con el botón izquierdo soltar sigue haciendo lo de siempre (mover, o copiar
 * con Shift). Con el derecho se abre un menú —copiar, mover o enlazar aquí— y
 * quien arrastró decide. Lo difícil es que WebKitGTK manda el `contextmenu` al
 * *apretar* el botón y no al soltarlo, así que el composable se lo traga
 * durante el arrastre para que no tape el menú del soltar.
 *
 * Se maneja el composable con eventos reales del DOM y se elige en el menú de
 * verdad (el del plugin, dibujado en `happy-dom`): lo que no se puede probar
 * sin ventana es el `contextmenu` real de WebKitGTK, que acá se reproduce a
 * mano.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick, ref } from 'vue';
import { useFileBrowser } from '@/composables/file-browser/use-file-browser';
import { useFileBrowserActions } from '@/composables/file-browser/use-file-browser-actions';
import {
	type DropOperationType,
	useFileBrowserDrag,
} from '@/composables/file-browser/use-file-browser-drag';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import type { DirEntry } from '@/types/dir-entry';
import { olvidarTodo, pedidos, responder } from './dobles';
import { archivo, carpeta } from './support/dir-entry';

const DESTINO = '/casa/destino';
const IZQUIERDO = 0;
const DERECHO = 2;

type Soltado = { items: string[]; destino: string; operacion: DropOperationType };

let montado: VueWrapper | null = null;
let zona: HTMLElement;
let filaDelOrigen: HTMLElement;

/** Una entrada en el DOM, con la caja que la prueba le pone (`happy-dom` no maqueta). */
function fila(ruta: string, caja: { left: number; top: number; right: number; bottom: number }) {
	const elemento = document.createElement('div');
	elemento.setAttribute('data-entry-path', ruta);
	elemento.setAttribute('data-drop-target', '');
	elemento.getBoundingClientRect = () => ({ ...caja, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
	zona.appendChild(elemento);
	return elemento;
}

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	document.body.innerHTML = '';
	zona = document.createElement('div');
	document.body.appendChild(zona);
	// Todo cerca del punto donde se aprieta (30, 30) y lejos de los bordes del
	// viewport: a más de 200 px de distancia o pegado a un borde, el arrastre se
	// vuelve «hacia afuera» y se lo lleva otra aplicación.
	filaDelOrigen = fila('/casa/a.txt', { left: 10, top: 10, right: 60, bottom: 60 });
	fila(DESTINO, { left: 100, top: 100, right: 200, bottom: 200 });
});

afterEach(() => {
	montado?.unmount();
	montado = null;
	// Un menú que quedó abierto engancha teclas y clics de la prueba que sigue.
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	document.body.innerHTML = '';
});

/** Monta el composable de arrastre y anota cada soltado que dispara. */
function montarArrastre(seleccion: DirEntry[] = [archivo('a.txt')]) {
	const soltados: Soltado[] = [];
	let api!: ReturnType<typeof useFileBrowserDrag>;
	const seleccionadas = ref(seleccion);

	montado = mount(
		defineComponent({
			setup() {
				api = useFileBrowserDrag({
					selectedEntries: seleccionadas,
					currentPath: ref('/casa'),
					componentRef: ref(zona),
					isEntrySelected: (entrada) =>
						seleccionadas.value.some((una) => una.path === entrada.path),
					replaceSelection: (entrada) => {
						seleccionadas.value = [entrada];
					},
					entriesContainerRef: ref(zona),
					onDrop: (items, destino, operacion) => {
						soltados.push({ items: items.map((una) => una.path), destino, operacion });
					},
				});
				return () => h('div');
			},
		})
	);
	return { api, soltados };
}

const evento = (tipo: string, init: MouseEventInit = {}) =>
	new MouseEvent(tipo, { bubbles: true, cancelable: true, ...init });

/** Aprieta el botón sobre la entrada, la arrastra hasta `hasta` y suelta. Dice si había arrastre al soltar. */
function arrastrar(
	api: ReturnType<typeof useFileBrowserDrag>,
	boton: number,
	hasta = { x: 150, y: 150 },
	soltar: MouseEventInit = {}
) {
	api.handleDragMouseDown(
		archivo('a.txt'),
		evento('mousedown', { button: boton, clientX: 30, clientY: 30 })
	);
	// El primer movimiento pasa el umbral y arranca el arrastre; el segundo llega al destino.
	window.dispatchEvent(evento('mousemove', { clientX: 60, clientY: 60 }));
	window.dispatchEvent(evento('mousemove', { clientX: hasta.x, clientY: hasta.y }));
	const arrastrando = api.isDragging.value;
	window.dispatchEvent(evento('mouseup', { clientX: hasta.x, clientY: hasta.y, ...soltar }));
	return arrastrando;
}

/** Los renglones del menú que está abierto, por su texto. */
const renglones = () =>
	[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((el) =>
		el.textContent?.trim()
	);

/** Espera a que el menú del plugin esté dibujado: lo arma tras leer la paleta. */
async function menuAbierto() {
	for (let i = 0; i < 20 && document.querySelector('[role="menu"]') === null; i++) {
		await new Promise((resolver) => setTimeout(resolver, 0));
	}
	await nextTick();
}

/** Hace clic en el renglón del menú cuyo texto contiene `clave`. */
async function elegir(clave: string) {
	await menuAbierto();
	const boton = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
		el.textContent?.includes(clave)
	);
	if (!boton) throw new Error(`el menú no tiene «${clave}»: ${JSON.stringify(renglones())}`);
	boton.click();
	// El `onDrop` llega después de que el menú resuelve su promesa.
	await new Promise((resolver) => setTimeout(resolver, 0));
}

describe('soltar con el botón izquierdo', () => {
	test('mueve sobre la carpeta de destino, sin abrir ningún menú', async () => {
		const { api, soltados } = montarArrastre();

		arrastrar(api, IZQUIERDO);
		await nextTick();

		expect(soltados).toEqual([{ items: ['/casa/a.txt'], destino: DESTINO, operacion: 'move' }]);
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	test('con Shift copia', () => {
		const { api, soltados } = montarArrastre();

		arrastrar(api, IZQUIERDO, undefined, { shiftKey: true });

		expect(soltados).toEqual([{ items: ['/casa/a.txt'], destino: DESTINO, operacion: 'copy' }]);
	});

	test('no se traga el menú del clic derecho: sale por el camino de siempre', () => {
		const { api } = montarArrastre();
		let abiertos = 0;
		filaDelOrigen.addEventListener('contextmenu', () => abiertos++);

		api.handleDragMouseDown(
			archivo('a.txt'),
			evento('mousedown', { button: IZQUIERDO, clientX: 30, clientY: 30 })
		);
		filaDelOrigen.dispatchEvent(evento('contextmenu'));

		expect(abiertos).toBe(1);
	});
});

describe('soltar con el botón derecho', () => {
	test('abre un menú con copiar, mover y enlazar aquí, y cancelar, sin soltar nada todavía', async () => {
		const { api, soltados } = montarArrastre();

		arrastrar(api, DERECHO);
		await menuAbierto();

		expect(renglones()).toEqual([
			'drag.dropMenu.copyHere',
			'drag.dropMenu.moveHere',
			'drag.dropMenu.linkHere',
			'drag.dropMenu.cancel',
		]);
		expect(soltados).toEqual([]);
	});

	test('elegir «copiar aquí» copia a la carpeta sobre la que se soltó', async () => {
		const { api, soltados } = montarArrastre();

		arrastrar(api, DERECHO);
		await elegir('copyHere');

		expect(soltados).toEqual([{ items: ['/casa/a.txt'], destino: DESTINO, operacion: 'copy' }]);
	});

	test('elegir «mover aquí» mueve', async () => {
		const { api, soltados } = montarArrastre();

		arrastrar(api, DERECHO);
		await elegir('moveHere');

		expect(soltados).toEqual([{ items: ['/casa/a.txt'], destino: DESTINO, operacion: 'move' }]);
	});

	test('elegir «enlazar aquí» enlaza', async () => {
		const { api, soltados } = montarArrastre();

		arrastrar(api, DERECHO);
		await elegir('linkHere');

		expect(soltados).toEqual([{ items: ['/casa/a.txt'], destino: DESTINO, operacion: 'link' }]);
	});

	test('elegir «cancelar» no hace nada', async () => {
		const { api, soltados } = montarArrastre();

		arrastrar(api, DERECHO);
		await elegir('cancel');

		expect(soltados).toEqual([]);
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	test('cerrar el menú con Escape no hace nada', async () => {
		const { api, soltados } = montarArrastre();

		arrastrar(api, DERECHO);
		await menuAbierto();
		expect(renglones()).toHaveLength(4);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await new Promise((resolver) => setTimeout(resolver, 0));

		expect(soltados).toEqual([]);
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	test('la operación elegida vale para toda la selección arrastrada', async () => {
		const { api, soltados } = montarArrastre([archivo('a.txt'), carpeta('docs')]);

		arrastrar(api, DERECHO);
		await elegir('linkHere');

		expect(soltados).toEqual([
			{ items: ['/casa/a.txt', '/casa/docs'], destino: DESTINO, operacion: 'link' },
		]);
	});

	test('Shift al soltar no cambia la elección: manda lo que se eligió en el menú', async () => {
		const { api, soltados } = montarArrastre();

		arrastrar(api, DERECHO, undefined, { shiftKey: true });
		await elegir('moveHere');

		expect(soltados).toEqual([{ items: ['/casa/a.txt'], destino: DESTINO, operacion: 'move' }]);
	});

	test('soltar donde no hay destino no abre el menú ni suelta nada', async () => {
		const { api, soltados } = montarArrastre();

		expect(arrastrar(api, DERECHO, { x: 40, y: 150 })).toBe(true);
		await new Promise((resolver) => setTimeout(resolver, 0));

		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(soltados).toEqual([]);
	});

	test('arrastrar sobre sí misma no es un destino', async () => {
		const { api, soltados } = montarArrastre();

		expect(arrastrar(api, DERECHO, { x: 45, y: 45 })).toBe(true);
		await new Promise((resolver) => setTimeout(resolver, 0));

		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(soltados).toEqual([]);
	});
});

describe('el menú del clic derecho durante el arrastre', () => {
	test('el que sale al apretar el botón se traga y no llega a la entrada', () => {
		const { api } = montarArrastre();
		let abiertos = 0;
		filaDelOrigen.addEventListener('contextmenu', () => abiertos++);
		api.handleDragMouseDown(
			archivo('a.txt'),
			evento('mousedown', { button: DERECHO, clientX: 30, clientY: 30 })
		);

		const crudo = evento('contextmenu');
		filaDelOrigen.dispatchEvent(crudo);

		expect(crudo.defaultPrevented).toBe(true);
		expect(abiertos).toBe(0);
	});

	test('un clic derecho sin arrastrar reenvía el menú de la entrada al soltar', () => {
		const { api, soltados } = montarArrastre();
		const abiertos: MouseEventInit[] = [];
		filaDelOrigen.addEventListener('contextmenu', (e) =>
			abiertos.push({ clientX: e.clientX, clientY: e.clientY, button: e.button })
		);

		api.handleDragMouseDown(
			archivo('a.txt'),
			evento('mousedown', { button: DERECHO, clientX: 30, clientY: 30 })
		);
		filaDelOrigen.dispatchEvent(evento('contextmenu'));
		expect(abiertos).toEqual([]);
		window.dispatchEvent(evento('mouseup', { clientX: 31, clientY: 32 }));

		// El menú de la entrada sale, una sola vez, donde se soltó.
		expect(abiertos).toEqual([{ clientX: 31, clientY: 32, button: DERECHO }]);
		expect(soltados).toEqual([]);
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	test('tras un arrastre se sigue tragando un instante y después se deja pasar', async () => {
		const { api } = montarArrastre();
		let abiertos = 0;
		filaDelOrigen.addEventListener('contextmenu', () => abiertos++);

		arrastrar(api, DERECHO);
		// Donde el menú nativo sale al soltar, llega después del `mouseup`.
		filaDelOrigen.dispatchEvent(evento('contextmenu'));
		expect(abiertos).toBe(0);

		await new Promise((resolver) => setTimeout(resolver, 0));
		filaDelOrigen.dispatchEvent(evento('contextmenu'));

		expect(abiertos).toBe(1);
	});

	test('un arrastre con el botón izquierdo no deja tragando el menú', async () => {
		const { api } = montarArrastre();
		let abiertos = 0;
		filaDelOrigen.addEventListener('contextmenu', () => abiertos++);

		arrastrar(api, IZQUIERDO);
		await new Promise((resolver) => setTimeout(resolver, 0));
		filaDelOrigen.dispatchEvent(evento('contextmenu'));

		expect(abiertos).toBe(1);
	});

	test('cancelar el arrastre a mitad de camino (Escape) también deja de tragarlo', async () => {
		const { api, soltados } = montarArrastre();
		let abiertos = 0;
		filaDelOrigen.addEventListener('contextmenu', () => abiertos++);
		api.handleDragMouseDown(
			archivo('a.txt'),
			evento('mousedown', { button: DERECHO, clientX: 30, clientY: 30 })
		);
		window.dispatchEvent(evento('mousemove', { clientX: 60, clientY: 60 }));
		expect(api.isDragging.value).toBe(true);

		api.cancelDrag();
		await new Promise((resolver) => setTimeout(resolver, 0));
		filaDelOrigen.dispatchEvent(evento('contextmenu'));

		expect(abiertos).toBe(1);
		expect(soltados).toEqual([]);
	});
});

describe('qué botones empiezan un arrastre', () => {
	test('el botón del medio no arrastra', () => {
		const { api } = montarArrastre();

		arrastrar(api, 1);

		expect(api.isDragging.value).toBe(false);
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	test('el botón derecho sí arranca el arrastre', () => {
		const { api } = montarArrastre();

		api.handleDragMouseDown(
			archivo('a.txt'),
			evento('mousedown', { button: DERECHO, clientX: 30, clientY: 30 })
		);
		window.dispatchEvent(evento('mousemove', { clientX: 60, clientY: 60 }));

		expect(api.isDragging.value).toBe(true);
		expect(api.dragItems.value.map((una) => una.path)).toEqual(['/casa/a.txt']);
		api.cancelDrag();
	});

	test('la fila entrega al arrastre los botones izquierdo y derecho, no el del medio', () => {
		const llamados: number[] = [];
		const { onEntryMouseDown } = useFileBrowserActions({
			contextMenu: ref({ selectedEntries: [] }) as never,
			selectedEntries: ref([]),
			quickViewStore: {} as never,
			handleContextMenuAction: () => {},
			openOpenWithDialog: () => {},
			handleEntryMouseDown: () => {},
			handleEntryMouseUp: () => {},
			handleDragMouseDown: (_entrada, e) => {
				llamados.push(e.button);
			},
			isDragging: ref(false),
		});

		for (const boton of [IZQUIERDO, 1, DERECHO]) {
			onEntryMouseDown(archivo('a.txt'), evento('mousedown', { button: boton }) as MouseEvent);
		}

		expect(llamados).toEqual([IZQUIERDO, DERECHO]);
	});
});

describe('enlazar al soltar, de punta a punta', () => {
	/** El navegador completo en modo externo: entradas dadas y carpeta base `/casa`. */
	function montarNavegador() {
		let api!: ReturnType<typeof useFileBrowser>;
		montado = mount(
			defineComponent({
				setup() {
					api = useFileBrowser({
						tab: () => undefined,
						layout: () => 'grid',
						externalEntries: () => [archivo('a.txt'), carpeta('destino')],
						basePath: () => '/casa',
						onSelectedEntriesChange: () => {},
						onCurrentDirEntryChange: () => {},
						onOpenEntry: () => {},
						componentRef: ref(null),
					});
					return () => h('div');
				},
			})
		);
		api.setEntriesContainerRef(zona);
		return api;
	}

	const apretarYSoltar = (api: ReturnType<typeof useFileBrowser>, boton: number) => {
		api.onEntryMouseDown(
			archivo('a.txt'),
			evento('mousedown', { button: boton, clientX: 30, clientY: 30 }) as MouseEvent
		);
		window.dispatchEvent(evento('mousemove', { clientX: 60, clientY: 60 }));
		window.dispatchEvent(evento('mousemove', { clientX: 150, clientY: 150 }));
		window.dispatchEvent(evento('mouseup', { clientX: 150, clientY: 150 }));
	};

	test('elegir «enlazar aquí» llama a link_items con lo arrastrado y no usa el portapapeles', async () => {
		responder('link_items', { success: true, copied_count: 1 });
		const api = montarNavegador();

		apretarYSoltar(api, DERECHO);
		await elegir('linkHere');
		await new Promise((resolver) => setTimeout(resolver, 0));

		const hechos = pedidos('link_items');
		expect(hechos).toHaveLength(1);
		expect(hechos[0].argumentos).toEqual({
			sourcePaths: ['/casa/a.txt'],
			destinationPath: DESTINO,
			conflictResolution: 'auto-rename',
		});
		// Enlazar no es copiar ni mover: ni toca el portapapeles ni esconde su barra.
		expect(pedidos('copy_items')).toHaveLength(0);
		expect(pedidos('move_items')).toHaveLength(0);
		const portapapeles = useClipboardStore();
		expect(portapapeles.hasItems).toBe(false);
		expect(portapapeles.isToolbarSuppressed).toBe(false);
	});

	test('elegir «cancelar» no le pide nada al backend', async () => {
		const api = montarNavegador();

		apretarYSoltar(api, DERECHO);
		await elegir('cancel');
		await new Promise((resolver) => setTimeout(resolver, 0));

		expect(pedidos('link_items')).toHaveLength(0);
		expect(pedidos('copy_items')).toHaveLength(0);
		expect(pedidos('move_items')).toHaveLength(0);
	});

	test('soltar con el botón izquierdo sigue moviendo por el camino de siempre y nunca enlaza', async () => {
		responder('check_conflicts', []);
		responder('move_items', { success: true, copied_count: 1 });
		const api = montarNavegador();

		apretarYSoltar(api, IZQUIERDO);
		await new Promise((resolver) => setTimeout(resolver, 0));
		await new Promise((resolver) => setTimeout(resolver, 0));

		expect(pedidos('link_items')).toHaveLength(0);
		expect(pedidos('move_items')).toHaveLength(1);
		expect(pedidos('move_items')[0].argumentos).toMatchObject({
			sourcePaths: ['/casa/a.txt'],
			destinationPath: DESTINO,
		});
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	test('elegir «mover aquí» en el menú mueve por el camino de siempre y no enlaza', async () => {
		responder('check_conflicts', []);
		responder('move_items', { success: true, copied_count: 1 });
		const api = montarNavegador();

		apretarYSoltar(api, DERECHO);
		await elegir('moveHere');
		await new Promise((resolver) => setTimeout(resolver, 0));

		expect(pedidos('link_items')).toHaveLength(0);
		expect(pedidos('move_items')).toHaveLength(1);
	});
});
