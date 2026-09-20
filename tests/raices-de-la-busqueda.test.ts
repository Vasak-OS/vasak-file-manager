/**
 * Por dónde recorre la búsqueda global.
 *
 * Recorría sólo lo que devolviera `get_system_drives`, y ese comando está
 * escrito para la sección «Discos» de la barra lateral: descarta `/` de forma
 * explícita y sólo deja lo que cuelgue de `/media`, `/mnt`, `/run/media` o sea
 * un sistema de archivos de red. En una máquina sin un pendrive enchufado ni un
 * recurso de red montado devuelve **nada**.
 *
 * O sea que la búsqueda global no tenía dónde buscar: el índice quedaba vacío
 * para siempre, el campo apagado y el cartel repitiendo que no hay nada
 * indexado. Se comprobó en una máquina de verdad —todos sus montajes son
 * btrfs en `/`, `/home`, `/srv`, `/var/*`, más `/boot` y overlays de docker—:
 * cero candidatos.
 *
 * Ahora la carpeta del usuario es una raíz por su cuenta, y las unidades se
 * suman cuando están.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { olvidarTodo, pedidos, responder } from './dobles';

/** Las raíces con las que se pidió el último recorrido. */
function raicesDelUltimoRecorrido(): string[] | undefined {
	const pedido = pedidos('global_search_start_scan').at(-1);
	return (pedido?.argumentos.settings as { drive_roots: string[] } | undefined)?.drive_roots;
}

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	responder('plugin:path|resolve_directory', '/home/quien');
});

afterEach(() => {
	olvidarTodo();
});

describe('las raíces del recorrido', () => {
	test('incluyen la carpeta del usuario aunque no haya ninguna unidad', async () => {
		// El caso de esta máquina, y el de cualquier escritorio sin nada
		// enchufado: antes de esto el recorrido ni se pedía.
		responder('get_system_drives', []);

		await useGlobalSearchStore().startScan();

		expect(raicesDelUltimoRecorrido()).toEqual(['/home/quien']);
	});

	test('y le suman las unidades que haya', async () => {
		responder('get_system_drives', [{ path: '/run/media/quien/USB' }, { path: '/mnt/red' }]);

		await useGlobalSearchStore().startScan();

		expect(raicesDelUltimoRecorrido()).toEqual(['/home/quien', '/run/media/quien/USB', '/mnt/red']);
	});

	test('sin repetir una que venga por los dos lados', async () => {
		// Una unidad montada justo en la carpeta del usuario haría que el
		// backend recorriera dos veces lo mismo.
		responder('get_system_drives', [{ path: '/home/quien' }, { path: '/mnt/red' }]);

		await useGlobalSearchStore().startScan();

		expect(raicesDelUltimoRecorrido()).toEqual(['/home/quien', '/mnt/red']);
	});

	test('y el otro camino arma la lista con la misma función', async () => {
		// `startScanWithCurrentDrives` —el que corre cuando cambian las
		// unidades— se armaba su propia lista con el store del frontend, sin la
		// carpeta del usuario. Dos listas distintas para lo mismo es cómo se
		// llega a que un camino indexe algo que el otro no.
		//
		// Se mira el fuente porque esa función no se exporta y llegar a ella
		// pide el observador de unidades y su espera de dos segundos: lo que
		// importa acá es que no vuelva a haber dos listas.
		const fuente = await Bun.file(
			new URL('../src/stores/runtime/global-search.ts', import.meta.url)
		).text();

		expect(fuente).not.toContain('sharedDrives.value.map((drive) => drive.path)');
		expect(fuente.match(/await getDriveRoots\(\)/g)?.length).toBe(2);
	});
});

describe('volver a recorrer cuando aparece una unidad', () => {
	test('la cuenta de partida arranca sin mirar, y no en cero', async () => {
		// La diferencia entre «todavía no miré» y «miré y había cero» es lo que
		// decide si la primera unidad que se enchufa dispara un recorrido. Con
		// un cero de partida, en una máquina que arranca sin unidades la
		// primera seguía pareciendo el valor inicial y no disparaba nada.
		const fuente = await Bun.file(
			new URL('../src/stores/runtime/global-search.ts', import.meta.url)
		).text();

		expect(fuente).toContain('const lastKnownDriveCount = ref<number | null>(null)');
		expect(fuente).toContain('if (lastKnownDriveCount.value === null)');
	});
});
