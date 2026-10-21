/**
 * El estado de la interfaz que sobrevive a cerrar la ventana.
 *
 * Escondías el panel lateral de información, cerrabas el gestor y al volver a
 * abrirlo estaba desplegado otra vez: el estado era un `ref(true)` del
 * componente y no se guardaba en ningún lado. Ahora vive en el almacén de
 * layout, junto a la vista (cuadrícula o lista), en el mismo archivo.
 *
 * El respaldo de `@tauri-apps/plugin-store` es un `Map` detrás del doble de
 * `invoke`: «cerrar y volver a abrir» es un pinia nuevo contra el mismo mapa.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useUserLayoutStore } from '@/stores/storage/user-layout';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { olvidarTodo, responder } from './dobles';

const disco = new Map<string, unknown>();

beforeEach(() => {
	olvidarTodo();
	disco.clear();
	responder('plugin:store|load', 1);
	responder('plugin:store|save', undefined);
	responder('plugin:store|set', ({ key, value }) => {
		disco.set(key as string, value);
	});
	responder('plugin:store|get', ({ key }) => [disco.get(key as string), disco.has(key as string)]);
});

/** Abrir la aplicación: un pinia nuevo, el mismo disco. */
async function abrirLaAplicacion() {
	setActivePinia(createPinia());
	useUserPathsStore().customPaths.appUserDataLayoutPath = '/datos/user-layout.json';
	const store = useUserLayoutStore();
	await store.init();
	return store;
}

describe('el panel de información', () => {
	test('la primera vez se ve desplegado', async () => {
		const store = await abrirLaAplicacion();
		expect(store.infoPanelVisible).toBe(true);
	});

	test('escondido, sigue escondido al volver a abrir la aplicación', async () => {
		const primera = await abrirLaAplicacion();
		await primera.setInfoPanelVisible(false);

		const segunda = await abrirLaAplicacion();
		expect(segunda.infoPanelVisible).toBe(false);
	});

	test('desplegado de nuevo, vuelve a abrirse desplegado', async () => {
		const primera = await abrirLaAplicacion();
		await primera.setInfoPanelVisible(false);
		await primera.setInfoPanelVisible(true);

		const segunda = await abrirLaAplicacion();
		expect(segunda.infoPanelVisible).toBe(true);
	});

	test('un archivo de antes, que sólo guardaba la vista, no lo esconde', async () => {
		disco.set('layout', 'list');

		const store = await abrirLaAplicacion();
		expect(store.layout).toBe('list');
		expect(store.infoPanelVisible).toBe(true);
	});

	test('guardar el panel no pisa la vista elegida', async () => {
		const primera = await abrirLaAplicacion();
		await primera.setLayout('list');
		await primera.setInfoPanelVisible(false);

		const segunda = await abrirLaAplicacion();
		expect(segunda.layout).toBe('list');
		expect(segunda.infoPanelVisible).toBe(false);
	});
});

describe('la ventana', () => {
	test('lee el panel del almacén y no de un estado propio', async () => {
		const fuente = await Bun.file(
			new URL('../src/layouts/WindowAppLayout.vue', import.meta.url)
		).text();
		expect(fuente).toContain('userLayoutStore.setInfoPanelVisible');
		expect(fuente).not.toContain('isInfoPanelVisible');
	});
});
