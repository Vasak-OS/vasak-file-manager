/**
 * Cuando la búsqueda global falla, lo dice.
 *
 * `lastError` existe desde siempre en el store y se escribe en trece lugares:
 * el estado del índice, el arranque, el recorrido de las unidades, cada
 * búsqueda, la señal de inactividad. **No lo leía nadie.** Cuando algo se
 * rompía, el panel se quedaba con el cartel de «todavía no hay índice» —que es
 * cierto, pero no dice por qué— y no había forma de enterarse de que había
 * habido un error.
 *
 * Y adentro de ese mismo campo vivía una frase escrita a mano y en inglés,
 * `'No drives available for scanning'`, que además **pisaba el error de
 * verdad**: la lista de unidades queda vacía sobre todo cuando
 * `get_system_drives` falla, y ese `catch` ya había anotado el motivo. Eso pasa
 * a ser un estado aparte, con su texto traducido.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import GlobalSearchView from '@/views/GlobalSearchView.vue';
import { olvidarTodo, pedidos, responder } from './dobles';

/** Deja que terminen las promesas del montaje. */
async function asentar(vueltas = 6) {
	for (let i = 0; i < vueltas; i++) {
		await Promise.resolve();
		await new Promise((sigue) => setTimeout(sigue, 0));
	}
}

let vista: VueWrapper | null = null;

afterEach(() => {
	// `useReactiveIcon` lleva la cuenta de cuántos la usan en una variable del
	// módulo y se suscribe al cambio de tema sólo cuando esa cuenta pasa de cero
	// a uno. Una vista que queda montada nunca la baja, y la siguiente prueba
	// —acá o **en otro archivo**— se salta la suscripción. Así se rompió la del
	// cambio de tema de `plantillas-estrictas`, que pasa sola y fallaba con la
	// suite entera.
	vista?.unmount();
	vista = null;
});

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	// El comando de verdad es `global_search_get_status`; las pruebas viejas le
	// contestaban a uno que no existe y acertaban por no contestar nada.
	responder('global_search_get_status', { is_scan_in_progress: false, indexed_item_count: 0 });
});

/**
 * El panel montado y **abierto**.
 *
 * Abierto de verdad: el estado del índice se pide cuando `isOpen` cambia, que
 * es por donde entran los errores del sondeo. Montado y cerrado no se pide
 * nada.
 */
async function abrirElPanel() {
	vista = mount(GlobalSearchView);
	await useGlobalSearchStore().open();
	await asentar();
	return vista;
}

describe('un error del backend', () => {
	test('se dibuja, con un título traducido y el detalle tal cual', async () => {
		// Por el camino de verdad: el sondeo de estado falla y lo anota.
		responder('global_search_get_status', () => {
			throw new Error('El índice está corrupto: invalid segment meta.json');
		});

		const panel = await abrirElPanel();
		await panel.vm.$nextTick();

		const texto = panel.text();
		// El doble de `t()` devuelve la clave, así que eso es lo que se lee.
		expect(texto).toContain('globalSearch.somethingFailed');
		expect(texto).toContain('El índice está corrupto: invalid segment meta.json');
	});

	test('y sin error no hay nada dibujado', async () => {
		// El cartel se limpia solo: cada operación que sale bien borra **su**
		// casillero. Si quedara puesto, diría que algo falla cuando ya no falla.
		const panel = await abrirElPanel();

		expect(panel.text()).not.toContain('globalSearch.somethingFailed');
	});
});

describe('quedarse sin unidades que recorrer', () => {
	test('tiene su propio texto, traducido', async () => {
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		store.sinRaices = true;
		await panel.vm.$nextTick();

		const texto = panel.text();
		expect(texto).toContain('globalSearch.nothingToScan');
		expect(texto).not.toContain('No drives available for scanning');
	});

	test('y ya no vive adentro del campo del error', async () => {
		// La frase en inglés se escribía en `lastError`, que es el campo donde
		// va lo que contesta el backend. Mezclados, no había forma de traducir
		// uno sin traducir el otro.
		const fuente = await Bun.file(
			new URL('../src/stores/runtime/global-search.ts', import.meta.url)
		).text();

		expect(fuente).not.toContain('No drives available for scanning');
	});

	test('la carpeta del usuario alcanza, aunque fallen las unidades', async () => {
		// Es el caso de verdad, recorrido entero: `get_system_drives` falla y su
		// `catch` anota el motivo. Antes el recorrido se cortaba ahí, porque las
		// unidades eran lo único que se miraba. Ahora la carpeta del usuario es
		// una raíz por su cuenta y el recorrido sigue con ella.
		responder('plugin:path|resolve_directory', '/home/quien');
		responder('get_system_drives', () => {
			throw new Error('permission denied');
		});
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		await store.startScan();
		await panel.vm.$nextTick();

		expect(store.sinRaices).toBe(false);
		const pedido = pedidos('global_search_start_scan').at(-1);
		const ajustes = pedido?.argumentos.settings as { drive_roots: string[] } | undefined;
		expect(ajustes?.drive_roots).toEqual(['/home/quien']);
	});

	test('y sin carpeta ni unidades, lo dice', async () => {
		// Las dos puntas caídas: el complemento de rutas no contesta y las
		// unidades fallan. Ahí sí no hay nada que recorrer, y es lo único que
		// el cartel puede decir.
		responder('get_system_drives', () => {
			throw new Error('permission denied');
		});
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		await store.startScan();
		await panel.vm.$nextTick();

		expect(store.sinRaices).toBe(true);
		expect(pedidos('global_search_start_scan')).toHaveLength(0);
		expect(panel.text()).toContain('globalSearch.nothingToScan');
	});
});

describe('un error no lo borra el éxito de otra cosa', () => {
	test('el sondeo de estado que sale bien deja en pie el de las raíces', async () => {
		// Es el caso que lo destapó y la razón de tener un casillero por
		// origen: enumerar las raíces falla y lo anota; medio segundo después
		// el sondeo contesta bien y —con una sola ranura— ponía el motivo en
		// nulo. El cartel se quedaba con «todavía no hay nada indexado», que no
		// explica por qué.
		responder('global_search_get_status', { is_scan_in_progress: false, indexed_item_count: 0 });
		responder('get_system_drives', () => {
			throw new Error('permission denied');
		});
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		await store.startScan();
		expect(store.lastError).toContain('permission denied');

		// El sondeo, que sale bien.
		await store.refreshStatus();
		await panel.vm.$nextTick();

		expect(store.lastError).toContain('permission denied');
		expect(panel.text()).toContain('permission denied');
	});

	test('y cada origen limpia el suyo cuando vuelve a salir bien', async () => {
		// La otra mitad: si nadie limpiara, el cartel diría para siempre algo
		// que ya se arregló.
		responder('global_search_get_status', { is_scan_in_progress: false, indexed_item_count: 0 });
		responder('get_system_drives', () => {
			throw new Error('permission denied');
		});
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		await store.startScan();
		expect(store.lastError).toContain('permission denied');

		// Las unidades vuelven.
		responder('get_system_drives', [{ path: '/mnt/red' }]);
		await store.startScan();
		await panel.vm.$nextTick();

		expect(store.lastError).toBeNull();
		expect(panel.text()).not.toContain('permission denied');
	});

	test('y con dos puestos se muestra el que más explica', async () => {
		// El orden no es casual: primero lo que rompió la búsqueda que alguien
		// acaba de escribir, después lo que explica que no haya índice.
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		store.errores = { estado: 'no se pudo leer el estado', raices: 'permission denied' };
		await panel.vm.$nextTick();

		expect(store.lastError).toBe('permission denied');
		expect(panel.text()).toContain('permission denied');
		expect(panel.text()).not.toContain('no se pudo leer el estado');
	});
});
