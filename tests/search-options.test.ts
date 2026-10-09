/**
 * Las opciones del panel de la búsqueda global llegan a la consulta.
 *
 * El panel mostraba el límite, la coincidencia exacta y la tolerancia, y la
 * consulta salía siempre con los valores fijos: tocarlas volvía a buscar lo
 * mismo. Ahora se guardan en el store y viajan con cada consulta.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { SEARCH_CONSTANTS } from '@/constants/search';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { olvidarTodo, pedidos, responder } from './dobles';

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	responder('global_search_get_status', {
		is_scan_in_progress: false,
		last_scan_time: 1,
		indexed_item_count: 10,
		index_size_bytes: 1,
		is_index_valid: true,
		last_scan_state: 'Completed',
		last_scan_is_live: false,
		index_missing: false,
		index_unavailable_reason: null,
	});
	responder('global_search_query', []);
	responder('global_search_query_paths', []);
});

async function searchFor(text: string) {
	const store = useGlobalSearchStore();
	await store.refreshStatus();
	store.setQuery(text);
	store.search();
	await new Promise((done) => setTimeout(done, 400));
	const sent = pedidos('global_search_query').at(-1);
	return sent?.argumentos.options as Record<string, unknown> | undefined;
}

describe('las opciones de la búsqueda', () => {
	test('sin tocar nada, salen las de siempre', async () => {
		const options = await searchFor('informe');

		expect(options?.limit).toBe(SEARCH_CONSTANTS.DEFAULT_RESULT_LIMIT);
		expect(options?.exact_match).toBe(false);
		expect(options?.typo_tolerance).toBe(true);
	});

	test('las del panel viajan con la consulta, también con la siguiente', async () => {
		const store = useGlobalSearchStore();
		store.setSearchOptions({ resultLimit: 10, exactMatch: true });

		const first = await searchFor('informe');
		expect(first?.limit).toBe(10);
		expect(first?.exact_match).toBe(true);
		expect(first?.typo_tolerance).toBe(true);

		const second = await searchFor('presupuesto');
		expect(second?.limit).toBe(10);
	});
});
