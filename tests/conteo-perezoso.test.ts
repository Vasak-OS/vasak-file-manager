/**
 * Conteo perezoso de los hijos de una carpeta (issue #115).
 *
 * Listar ya no cuenta; la ventana pide el conteo con `count_dir_items` y lo
 * guarda en el store. El orden por la columna «items» lee de ese store.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useDirItemCountsStore } from '@/stores/runtime/dir-item-counts';
import { sortFileBrowserEntries } from '@/utils/file-browser-sort';
import { olvidarTodo, pedidos, responder } from './dobles';
import { archivo, carpeta, nombres } from './support/dir-entry';

type Conteo = { path: string; count: number | null };

const responderConteos = (hacer: (paths: string[]) => Conteo[] | Promise<Conteo[]>) =>
	responder('count_dir_items', (args: Record<string, unknown>) => hacer(args.paths as string[]));

beforeEach(() => {
	olvidarTodo();
	setActivePinia(createPinia());
	responderConteos((paths) => paths.map((path) => ({ path, count: path.length })));
});

describe('store de conteos de carpetas', () => {
	test('antes de pedir, el conteo es indefinido y no está cargando', () => {
		const store = useDirItemCountsStore();
		expect(store.getCount('/a')).toBeUndefined();
		expect(store.isLoading('/a')).toBe(false);
	});

	test('mientras llega la respuesta la ruta figura como cargando', async () => {
		const store = useDirItemCountsStore();
		let soltar: (v: Conteo[]) => void = () => {};
		responderConteos(() => new Promise((resolve) => (soltar = resolve)));

		const espera = store.requestCountsBatch(['/a']);
		expect(store.isLoading('/a')).toBe(true);
		expect(store.getCount('/a')).toBeUndefined();

		soltar([{ path: '/a', count: 4 }]);
		await espera;
		expect(store.isLoading('/a')).toBe(false);
		expect(store.getCount('/a')).toBe(4);
	});

	test('un conteo nulo (red o error) se guarda como null, no como indefinido', async () => {
		const store = useDirItemCountsStore();
		responderConteos((paths) => paths.map((path) => ({ path, count: null })));
		await store.requestCountsBatch(['/red']);
		expect(store.getCount('/red')).toBeNull();
	});

	test('no vuelve a pedir lo ya resuelto ni lo que está pendiente', async () => {
		const store = useDirItemCountsStore();
		await store.requestCountsBatch(['/a', '/b']);
		expect(pedidos('count_dir_items').map((p) => p.argumentos.paths)).toEqual([['/a', '/b']]);

		await store.requestCountsBatch(['/a', '/b']);
		expect(pedidos('count_dir_items')).toHaveLength(1);

		await store.requestCountsBatch(['/a', '/c']);
		expect(pedidos('count_dir_items')[1].argumentos.paths).toEqual(['/c']);

		let soltar: () => void = () => {};
		responderConteos(
			(paths) =>
				new Promise((resolve) => {
					soltar = () => resolve(paths.map((path) => ({ path, count: 1 })));
				})
		);
		const primera = store.requestCountsBatch(['/d']);
		const segunda = store.requestCountsBatch(['/d']);
		expect(pedidos('count_dir_items')).toHaveLength(3);
		soltar();
		await Promise.all([primera, segunda]);
	});

	test('si el comando falla, la ruta deja de estar cargando y se puede reintentar', async () => {
		const store = useDirItemCountsStore();
		const log = console.error;
		console.error = () => {};
		responder('count_dir_items', () => {
			throw new Error('boom');
		});
		try {
			await store.requestCountsBatch(['/a']);
		} finally {
			console.error = log;
		}

		expect(store.isLoading('/a')).toBe(false);
		expect(store.getCount('/a')).toBeUndefined();
	});

	test('clearLocalCache olvida conteos y pendientes', async () => {
		const store = useDirItemCountsStore();
		await store.requestCountsBatch(['/a']);
		store.clearLocalCache();
		expect(store.getCount('/a')).toBeUndefined();
		await store.requestCountsBatch(['/a']);
		expect(pedidos('count_dir_items')).toHaveLength(2);
	});
});

describe('orden por la columna «items»', () => {
	const sinTamanos = { getSize: () => undefined } as never;

	test('ordena las carpetas por su conteo conocido y deja las desconocidas al principio (-1)', async () => {
		const store = useDirItemCountsStore();
		responderConteos(() => [
			{ path: '/casa/grande', count: 30 },
			{ path: '/casa/chica', count: 2 },
			{ path: '/casa/red', count: null },
		]);
		await store.requestCountsBatch(['/casa/grande', '/casa/chica', '/casa/red']);

		const entradas = [
			carpeta('grande'),
			carpeta('chica'),
			carpeta('red'),
			carpeta('sinpedir'),
			archivo('a.txt'),
		];
		const asc = sortFileBrowserEntries(entradas, 'items', 'asc', sinTamanos, store);
		expect(nombres(asc).slice(0, 4).sort()).toEqual(['chica', 'grande', 'red', 'sinpedir']);
		expect(nombres(asc).slice(2, 4)).toEqual(['chica', 'grande']);
		expect(nombres(asc)[4]).toBe('a.txt');

		const desc = sortFileBrowserEntries(entradas, 'items', 'desc', sinTamanos, store);
		expect(nombres(desc).slice(0, 2)).toEqual(['grande', 'chica']);
	});

	test('al llegar los conteos el orden se reacomoda', async () => {
		const store = useDirItemCountsStore();
		const entradas = [carpeta('a'), carpeta('b')];
		const antes = sortFileBrowserEntries(entradas, 'items', 'asc', sinTamanos, store);
		expect(nombres(antes)).toEqual(['a', 'b']);

		responderConteos(() => [
			{ path: '/casa/a', count: 9 },
			{ path: '/casa/b', count: 1 },
		]);
		await store.requestCountsBatch(['/casa/a', '/casa/b']);
		const despues = sortFileBrowserEntries(entradas, 'items', 'asc', sinTamanos, store);
		expect(nombres(despues)).toEqual(['b', 'a']);
	});
});
