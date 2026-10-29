/**
 * El arrastre saliente (#148): cuando el cursor sale de la ventana el arrastre
 * se lo lleva otra aplicación (`startDrag` del plugin de Wayland).
 *
 * Lo que se prueba es que un fallo al preparar ese arrastre —el ícono que no se
 * resuelve— no deje trabado el aviso de «arrastre saliente en curso»: si quedara
 * en `true`, ningún arrastre saliente posterior arrancaría hasta reiniciar.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, ref } from 'vue';
import { useFileBrowserDrag } from '@/composables/file-browser/use-file-browser-drag';
import { olvidarTodo, pedidos, responder } from './dobles';
import { archivo } from './support/dir-entry';

const ICONO = 'plugin:path|resolve_directory';
const ARRASTRE = 'plugin:drag-and-drop-wayland|start_drag';

let montado: VueWrapper | null = null;
let api: ReturnType<typeof useFileBrowserDrag>;

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	document.body.innerHTML = '';
	const zona = document.createElement('div');
	document.body.appendChild(zona);
	const seleccionadas = ref([archivo('a.txt')]);
	montado = mount(
		defineComponent({
			setup() {
				api = useFileBrowserDrag({
					selectedEntries: seleccionadas,
					currentPath: ref('/casa'),
					componentRef: ref(zona),
					isEntrySelected: () => true,
					replaceSelection: () => {},
					entriesContainerRef: ref(zona),
					onDrop: () => {},
				});
				return () => h('div');
			},
		})
	);
});

afterEach(() => {
	montado?.unmount();
	montado = null;
	document.body.innerHTML = '';
});

const evento = (tipo: string, init: MouseEventInit = {}) =>
	new MouseEvent(tipo, { bubbles: true, cancelable: true, ...init });

/** Empieza un arrastre y lo saca de la ventana: dispara el arrastre saliente. */
async function sacarDeLaVentana() {
	api.handleDragMouseDown(archivo('a.txt'), evento('mousedown', { clientX: 30, clientY: 30 }));
	// El primer movimiento pasa el umbral; el segundo, ya fuera del viewport, lo dispara.
	window.dispatchEvent(evento('mousemove', { clientX: 60, clientY: 60 }));
	window.dispatchEvent(evento('mousemove', { clientX: 0, clientY: 60 }));
	// El arrastre saliente es dispara-y-olvida: se cede para que termine.
	await new Promise((resolver) => setTimeout(resolver, 0));
}

describe('initiateOutboundDrag', () => {
	test('arranca el arrastre saliente con la ruta del archivo y el ícono resuelto', async () => {
		responder(ICONO, '/usr/share/icon.png');
		responder(ARRASTRE, () => undefined);

		await sacarDeLaVentana();

		const [pedido] = pedidos(ARRASTRE);
		expect(pedido.argumentos.item).toEqual(['/casa/a.txt']);
		expect(pedido.argumentos.image).toBe('/usr/share/icon.png');
	});

	test('si el ícono no se resuelve, un arrastre saliente posterior igual arranca', async () => {
		const consola = spyOn(console, 'error').mockImplementation(() => {});
		let intentos = 0;
		responder(ICONO, () => {
			intentos++;
			if (intentos === 1) throw new Error('recurso no encontrado');
			return '/usr/share/icon.png';
		});
		responder(ARRASTRE, () => undefined);

		await sacarDeLaVentana();
		// El primero falló antes de entregarle nada a la otra aplicación.
		expect(pedidos(ARRASTRE)).toHaveLength(0);

		// Se mueve otra vez fuera de la ventana: con el aviso trabado en `true`
		// este movimiento no volvería a intentar el arrastre saliente.
		window.dispatchEvent(evento('mousemove', { clientX: 0, clientY: 70 }));
		await new Promise((resolver) => setTimeout(resolver, 0));

		expect(pedidos(ARRASTRE)).toHaveLength(1);
		expect(consola).toHaveBeenCalled();
		consola.mockRestore();
	});
});
