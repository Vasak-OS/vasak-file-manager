/**
 * Piso de longitud de la consulta de la búsqueda global (issue #114).
 *
 * Una consulta de un carácter satura el índice por un resultado inútil: no se
 * le pregunta al backend hasta tener al menos dos.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { olvidarTodo, pedidos, responder } from './dobles';

async function storeConIndice() {
	responder('global_search_get_status', { indexed_item_count: 100 });
	responder('global_search_query', []);
	responder('global_search_query_paths', []);
	const store = useGlobalSearchStore();
	await store.refreshStatus();
	return store;
}

/** Escribe en el cuadro y deja correr el debounce con el reloj simulado. */
async function escribir(store: Awaited<ReturnType<typeof storeConIndice>>, texto: string) {
	store.setQuery(texto);
	await Promise.resolve(); // el watch de Vue corre en el microtask siguiente
	jest.advanceTimersByTime(500);
	for (let i = 0; i < 10; i++) await Promise.resolve(); // deja terminar executeSearch
}

beforeEach(() => {
	jest.useFakeTimers();
	olvidarTodo();
	setActivePinia(createPinia());
});

afterEach(() => jest.useRealTimers());

describe('piso de longitud de la búsqueda global', () => {
	test('una consulta de un carácter no le pregunta al índice y deja los resultados vacíos', async () => {
		const store = await storeConIndice();
		await escribir(store, 'e');
		expect(pedidos('global_search_query')).toHaveLength(0);
		expect(pedidos('global_search_query_paths')).toHaveLength(0);
		expect(store.results).toEqual([]);
	});

	test('una consulta de dos caracteres sí le pregunta al índice', async () => {
		const store = await storeConIndice();
		await escribir(store, 'do');
		expect(pedidos('global_search_query')).toHaveLength(1);
	});

	test('una consulta vacía o de sólo espacios no dispara nada', async () => {
		const store = await storeConIndice();
		await escribir(store, ' ');
		await escribir(store, '');
		await escribir(store, '   ');
		expect(pedidos('global_search_query')).toHaveLength(0);
	});
});
