/**
 * Carrera de arranque de los ajustes (#176): un cambio hecho antes de que
 * `init()` termine no se pierde ni lo pisa lo guardado en disco.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useUserSettingsStore } from '@/stores/storage/user-settings';
import { invocaciones, olvidarTodo, pedidos, responder } from './dobles';

const disco = new Map<string, unknown>();

beforeEach(() => {
	olvidarTodo();
	disco.clear();
	responder('plugin:store|load', 1);
	responder('plugin:store|save', undefined);
	responder('plugin:store|set', ({ key, value }) => {
		disco.set(key as string, JSON.parse(JSON.stringify(value)));
	});
	responder('plugin:store|get', ({ key }) => [disco.get(key as string), disco.has(key as string)]);
	document.documentElement.classList.remove('reduce-motion', 'low-power');
	document.documentElement.style.fontSize = '';
});

function nuevoStore() {
	setActivePinia(createPinia());
	useUserPathsStore().customPaths.appUserDataSettingsPath = '/datos/user-settings.json';
	return useUserSettingsStore();
}

describe('la carrera de arranque de los ajustes', () => {
	test('un cambio hecho antes de init se conserva y lo guardado sobrevive en los campos no tocados', async () => {
		disco.set('settings', { reduceMotion: true, lowPower: false, textSize: 'small' });
		const store = nuevoStore();

		await store.update({ textSize: 'large' });
		await store.init();

		expect(store.settings.textSize).toBe('large');
		expect(store.settings.reduceMotion).toBe(true);
		expect(document.documentElement.style.fontSize).toBe('18px');
		expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
		expect(disco.get('settings')).toEqual({
			reduceMotion: true,
			lowPower: false,
			textSize: 'large',
		});
		expect(pedidos('plugin:store|set').at(-1)?.argumentos.key).toBe('settings');
	});

	test('un init posterior a un cambio no lo revierte al valor del disco', async () => {
		const store = nuevoStore();
		await store.init();

		await store.update({ lowPower: true });
		// Lo que hay en disco queda distinto de lo que el usuario acaba de elegir.
		disco.set('settings', { reduceMotion: false, lowPower: false, textSize: 'small' });
		await store.init();

		expect(store.settings.lowPower).toBe(true);
		expect(store.settings.textSize).toBe('small');
	});

	test('sin ningún cambio previo, init carga lo guardado como siempre', async () => {
		disco.set('settings', { reduceMotion: true, lowPower: true, textSize: 'small' });
		const store = nuevoStore();

		await store.init();

		expect(store.settings).toEqual({ reduceMotion: true, lowPower: true, textSize: 'small' });
		expect(pedidos('plugin:store|set')).toHaveLength(0);
	});

	test('un cambio hecho mientras el get de load está pendiente no se pierde', async () => {
		disco.set('settings', { reduceMotion: true, lowPower: false, textSize: 'small' });
		let soltar!: () => void;
		const compuerta = new Promise<void>((r) => {
			soltar = r;
		});
		let entro!: () => void;
		const getLlamado = new Promise<void>((r) => {
			entro = r;
		});
		responder('plugin:store|get', async ({ key }) => {
			// Lee el disco al pedirlo, como el backend: lo que llegue después no cambia la respuesta.
			const respuesta = [disco.get(key as string), disco.has(key as string)];
			entro();
			await compuerta;
			return respuesta;
		});
		const store = nuevoStore();

		const arranque = store.init();
		await getLlamado;
		await store.update({ textSize: 'large' });
		soltar();
		await arranque;

		expect(store.settings).toEqual({ reduceMotion: true, lowPower: false, textSize: 'large' });
		expect(disco.get('settings')).toEqual({
			reduceMotion: true,
			lowPower: false,
			textSize: 'large',
		});
	});

	test('varios cambios tempranos se acumulan por campo', async () => {
		disco.set('settings', { reduceMotion: true, lowPower: false, textSize: 'small' });
		const store = nuevoStore();

		await store.update({ lowPower: true });
		await store.update({ textSize: 'large' });
		await store.init();

		expect(store.settings).toEqual({ reduceMotion: true, lowPower: true, textSize: 'large' });
	});

	test('update sin la ruta lista no construye el almacén', async () => {
		setActivePinia(createPinia());
		useUserPathsStore().customPaths.appUserDataSettingsPath = '';
		const store = useUserSettingsStore();

		await store.update({ lowPower: true });

		expect(store.settings.lowPower).toBe(true);
		expect(invocaciones.filter((i) => i.comando.startsWith('plugin:store|'))).toHaveLength(0);
	});
});
