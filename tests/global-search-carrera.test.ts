/**
 * Carrera de la búsqueda global: una respuesta cancelada que llega tarde no
 * debe pisar a la búsqueda que la reemplazó.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { olvidarTodo, responder } from './dobles';

const entrada = (name: string) => ({
	name,
	ext: null,
	path: `/home/u/${name}`,
	size: 0,
	is_file: true,
	is_dir: false,
	is_symlink: false,
	is_hidden: false,
});

/** Una respuesta del backend que la prueba resuelve cuando quiere. */
function diferida() {
	let resolver!: (valor: unknown) => void;
	const promesa = new Promise((r) => {
		resolver = r;
	});
	return { promesa, resolver };
}

async function vaciar() {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Escribe en el cuadro y deja correr el debounce con el reloj simulado. */
async function escribir(store: ReturnType<typeof useGlobalSearchStore>, texto: string) {
	store.setQuery(texto);
	await Promise.resolve(); // el watch de Vue corre en el microtask siguiente
	jest.advanceTimersByTime(500);
	await vaciar();
}

beforeEach(() => {
	jest.useFakeTimers();
	olvidarTodo();
	setActivePinia(createPinia());
	responder('global_search_get_status', { indexed_item_count: 100 });
	responder('global_search_query_paths', []);
});

afterEach(() => jest.useRealTimers());

describe('carrera de cancelación de la búsqueda global', () => {
	test('una búsqueda normal sin cancelación escribe sus resultados', async () => {
		responder('global_search_query', [entrada('informe')]);
		const store = useGlobalSearchStore();
		await store.refreshStatus();

		await escribir(store, 'in');

		expect(store.results.map((r) => r.name)).toEqual(['informe']);
		expect(store.isSearching).toBe(false);
	});

	test('la respuesta tardía de una búsqueda cancelada no pisa los resultados ni el estado de la nueva', async () => {
		const porConsulta = new Map<string, ReturnType<typeof diferida>>();
		responder('global_search_query', (args: Record<string, unknown>) => {
			const d = diferida();
			porConsulta.set(args.query as string, d);
			return d.promesa;
		});
		const store = useGlobalSearchStore();
		await store.refreshStatus();

		await escribir(store, 'ab'); // A queda en vuelo
		await escribir(store, 'cd'); // B cancela a A y queda en vuelo
		expect(store.isSearching).toBe(true);

		// A resuelve tarde, ya cancelada.
		porConsulta.get('ab')?.resolver([entrada('vieja')]);
		await vaciar();

		expect(store.results).toEqual([]);
		expect(store.isSearching).toBe(true);

		// B sigue siendo la vigente y escribe lo suyo.
		porConsulta.get('cd')?.resolver([entrada('nueva')]);
		await vaciar();

		expect(store.results.map((r) => r.name)).toEqual(['nueva']);
		expect(store.isSearching).toBe(false);
	});
});
