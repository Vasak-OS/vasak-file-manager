/**
 * Los iconos que sólo tienen que aparecer a veces.
 *
 * Al pasar los `<img>` a `ThemeIcon` se perdieron veinte condiciones —`v-if`,
 * `v-else`, clases atadas a un estado— y **ninguna prueba lo notó**: el
 * componente seguía montando, los tipos seguían en cero y la suite entera en
 * verde. Lo único que cambiaba era lo que se dibuja, que es justo lo que no se
 * mira desde acá.
 *
 * El síntoma no es un icono que falta sino uno de más: el candado en una unidad
 * sin cifrar dice que hay que escribir una frase de paso, y las dos flechas de
 * orden a la vez dejan sin saber por cuál columna está ordenado.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { olvidarLosIconosDelTema } from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import DriveCardComponent from '@/components/drive/DriveCardComponent.vue';
import type { DriveInfo } from '@/types/drive-info';
import { olvidarTodo, ponerEnElTema } from './dobles';

const UNIDAD: DriveInfo = {
	name: 'Disco',
	path: '/dev/sda1',
	mount_point: '/mnt/disco',
	file_system: 'ext4',
	drive_type: 'Fixed',
	total_space: 100,
	available_space: 50,
	used_space: 50,
	percent_used: 50,
	is_removable: false,
	is_read_only: false,
	is_mounted: true,
	is_encrypted: false,
	device_path: '/dev/sda1',
};

let vista: VueWrapper | null = null;

beforeEach(() => {
	olvidarTodo();
	olvidarLosIconosDelTema();
	setActivePinia(createPinia());
	ponerEnElTema('object-locked', 'data:image/svg+xml,candado');
	ponerEnElTema('drive-harddisk', 'data:image/svg+xml,disco');
});

afterEach(() => {
	vista?.unmount();
	vista = null;
});

async function asentar(vueltas = 8) {
	for (let i = 0; i < vueltas; i++) {
		await new Promise((sigue) => setTimeout(sigue, 0));
	}
}

async function conLaUnidad(cifrada: boolean) {
	vista = mount(DriveCardComponent, {
		props: { drive: { ...UNIDAD, is_encrypted: cifrada } },
	});
	await asentar();
	return vista;
}

describe('el candado de la unidad cifrada', () => {
	test('aparece cuando la unidad está cifrada', async () => {
		// Dice que ese clic va a pedir una frase de paso. Sin él, el diálogo
		// aparece sin que nada lo anunciara.
		const pantalla = await conLaUnidad(true);

		expect(pantalla.html()).toContain('data:image/svg+xml,candado');
	}, 60000);

	test('no aparece cuando no lo está', async () => {
		// El que se perdió en la migración. Un candado en una unidad sin cifrar
		// no es un icono que falta: es uno que miente.
		const pantalla = await conLaUnidad(false);

		expect(pantalla.html()).not.toContain('data:image/svg+xml,candado');
	}, 60000);
});
