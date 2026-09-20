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
	responder('get_index_status', { indexed_item_count: 0 });
});

async function abrirElPanel() {
	vista = mount(GlobalSearchView);
	await asentar();
	return vista;
}

describe('un error del backend', () => {
	test('se dibuja, con un título traducido y el detalle tal cual', async () => {
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		store.lastError = 'El índice está corrupto: invalid segment meta.json';
		await panel.vm.$nextTick();

		const texto = panel.text();
		// El doble de `t()` devuelve la clave, así que eso es lo que se lee.
		expect(texto).toContain('globalSearch.somethingFailed');
		expect(texto).toContain('El índice está corrupto: invalid segment meta.json');
	});

	test('y sin error no hay nada dibujado', async () => {
		// El cartel se limpia solo: cada operación que sale bien pone
		// `lastError` en nulo. Si quedara puesto, diría que algo falla cuando ya
		// no falla.
		const panel = await abrirElPanel();

		expect(panel.text()).not.toContain('globalSearch.somethingFailed');
	});
});

describe('quedarse sin unidades que recorrer', () => {
	test('tiene su propio texto, traducido', async () => {
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		store.sinUnidades = true;
		await panel.vm.$nextTick();

		const texto = panel.text();
		expect(texto).toContain('globalSearch.noDrivesToScan');
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

	test('y no pisa el error que sí explica por qué no hay unidades', async () => {
		// Es el caso de verdad, recorrido entero: `get_system_drives` falla, su
		// `catch` anota el motivo, la lista de unidades queda vacía y el
		// recorrido se corta. Antes, ese corte escribía una frase genérica
		// encima del motivo y lo único que quedaba era la frase.
		responder('get_system_drives', () => {
			throw new Error('permission denied');
		});
		const panel = await abrirElPanel();
		const store = useGlobalSearchStore();

		await store.startScan();
		await panel.vm.$nextTick();

		expect(store.sinUnidades).toBe(true);
		expect(store.lastError).toContain('permission denied');
		// Y es el motivo lo que se lee, no la frase genérica.
		expect(panel.text()).toContain('permission denied');
	});
});
