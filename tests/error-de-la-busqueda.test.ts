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
 * Desde la 0.22 el índice lo mantiene `vasak-prism` y esta aplicación sólo lo
 * lee, así que los errores del recorrido —unidades que no se pueden enumerar,
 * raíces que no resuelven— dejaron de existir acá. El que ocupó su lugar es el
 * que importa ahora: **que no haya índice**, que no es un fallo de nadie y que
 * hay que saber distinguir de «hay índice y no hay resultados».
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import GlobalSearchView from '@/views/GlobalSearchView.vue';
import { olvidarTodo, responder } from './dobles';

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

describe('cuando todavía no hay índice', () => {
	test('lo dice, y dice quién lo mantiene', async () => {
		// Es lo único que alguien puede hacer al respecto: esta aplicación ya no
		// arma el índice, así que un cartel de «no hay nada indexado» a secas
		// deja a quien lo lee sin ninguna acción posible. Tiene que nombrar al
		// lanzador.
		responder('global_search_get_status', {
			is_scan_in_progress: false,
			indexed_item_count: 0,
			index_missing: true,
		});
		const panel = await abrirElPanel();

		const texto = panel.text();
		expect(texto).toContain('globalSearch.noIndexYet');
		expect(texto).toContain('globalSearch.noIndexYetDescription');
	});

	test('y no lo pinta como una falla, porque no lo es', async () => {
		// El rojo es para lo que está roto. La primera búsqueda en una máquina
		// recién instalada no lo está: el lanzador todavía no escaneó.
		responder('global_search_get_status', {
			is_scan_in_progress: false,
			indexed_item_count: 0,
			index_missing: true,
		});
		const panel = await abrirElPanel();

		expect(panel.text()).not.toContain('globalSearch.somethingFailed');
		expect(panel.html()).not.toContain('bg-status-error');
	});

	test('un índice que no se puede abrir sí es una falla, y dice por qué', async () => {
		// El otro caso, que antes se veía igual que el de arriba: hay índice y
		// no se entiende —el esquema es de otra versión del lanzador—. Decirle
		// «abrí Prism» no lo arregla; el motivo técnico sí sirve.
		responder('global_search_get_status', {
			is_scan_in_progress: false,
			indexed_item_count: 0,
			index_missing: false,
			index_unavailable_reason: 'el índice es de otra versión del esquema',
		});
		const panel = await abrirElPanel();

		const texto = panel.text();
		expect(texto).toContain('globalSearch.somethingFailed');
		expect(texto).toContain('el índice es de otra versión del esquema');
		expect(texto).not.toContain('globalSearch.noIndexYet');
	});

	test('y con índice no aparece ese cartel', async () => {
		// La otra mitad: un cartel que sale siempre no informa nada.
		responder('global_search_get_status', {
			is_scan_in_progress: false,
			indexed_item_count: 1234,
			index_missing: false,
			index_unavailable_reason: null,
		});
		const panel = await abrirElPanel();

		expect(panel.text()).not.toContain('globalSearch.noIndexYet');
	});

	test('mientras el lanzador indexa se avisa, sin inventar un progreso', async () => {
		// Acá había una barra con la unidad en curso y un «3 de 5». El escaneo
		// es de otro proceso y lo que llega es un archivo de estado: cuánto
		// falta **no se sabe**. Avisar que está pasando es cierto; dibujar una
		// barra que avanza, no.
		responder('global_search_get_status', {
			is_scan_in_progress: true,
			indexed_item_count: 10,
			index_missing: false,
			index_unavailable_reason: null,
		});
		const panel = await abrirElPanel();

		expect(panel.text()).toContain('globalSearch.launcherIsIndexing');
		expect(panel.text()).not.toContain('globalSearch.driveScanInProgress');
	});

	test('el recorrido propio ya no existe en el código', async () => {
		// Se fue entero a `vasak-prism`. Si alguien lo trae de vuelta acá, hay
		// dos escritores sobre un índice que admite uno solo.
		const fuente = await Bun.file(
			new URL('../src/stores/runtime/global-search.ts', import.meta.url)
		).text();

		expect(fuente).not.toContain('global_search_start_scan');
		expect(fuente).not.toContain('global_search_cancel_scan');
		expect(fuente).not.toContain('global_search_index_paths');
	});
});

describe('un error no lo borra el éxito de otra cosa', () => {
	test('cada origen limpia el suyo, y sólo el suyo', async () => {
		// Es la razón de tener un casillero por origen: con una sola ranura, una
		// operación que sale bien pone en nulo el motivo de otra que sigue rota,
		// y el cartel se queda diciendo algo que no explica nada.
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		store.errores = { busqueda: 'la consulta falló', estado: 'no se pudo leer el estado' };
		await panel.vm.$nextTick();

		// El sondeo, que sale bien, limpia el suyo y deja el otro.
		await store.refreshStatus();
		await panel.vm.$nextTick();

		expect(store.errores.estado).toBeUndefined();
		expect(store.lastError).toBe('la consulta falló');
		expect(panel.text()).toContain('la consulta falló');
	});

	test('y con dos puestos se muestra el que más explica', async () => {
		// El orden no es casual: primero lo que rompió la búsqueda que alguien
		// acaba de escribir, y después lo de fondo.
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		store.errores = { estado: 'no se pudo leer el estado', busqueda: 'la consulta falló' };
		await panel.vm.$nextTick();

		expect(store.lastError).toBe('la consulta falló');
		expect(panel.text()).toContain('la consulta falló');
		expect(panel.text()).not.toContain('no se pudo leer el estado');
	});
});
