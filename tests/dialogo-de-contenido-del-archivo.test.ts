/**
 * El diálogo que lista lo que hay dentro de un archivo comprimido (#149).
 *
 * Dibuja a lo sumo 500 filas: un archivo con decenas de miles de entradas no
 * tiene que colgar la ventana, y lo que sobra se resume en una línea.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { forgetThemeIcons } from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ArchiveContentDialogComponent from '@/components/dialogs/ArchiveContentDialogComponent.vue';
import { olvidarTodo } from './dobles';

let vista: VueWrapper | null = null;

const elPanel = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const filas = () => [...(elPanel()?.querySelectorAll('li') ?? [])];

async function abrir(items: string[], archiveName = 'caja.zip') {
	vista = mount(ArchiveContentDialogComponent, {
		props: { open: false, archiveName, items },
		attachTo: document.body,
	});
	await vista.setProps({ open: true });
	await nextTick();
	await nextTick();
}

beforeEach(() => {
	olvidarTodo();
	forgetThemeIcons();
	setActivePinia(createPinia());
});

afterEach(() => {
	vista?.unmount();
	vista = null;
	for (const suelto of document.body.querySelectorAll('[role="dialog"]')) {
		suelto.parentElement?.remove();
	}
});

describe('el diálogo del contenido de un archivo', () => {
	test('muestra cada entrada, en orden, con su ruta completa de ayuda', async () => {
		await abrir(['uno.txt', 'sub/dos.txt']);

		expect(filas().map((fila) => fila.textContent?.trim())).toEqual(['uno.txt', 'sub/dos.txt']);
		expect(filas().map((fila) => fila.getAttribute('title'))).toEqual(['uno.txt', 'sub/dos.txt']);
		expect(elPanel()?.textContent).toContain('dialogs.archiveContentDialog.title');
	});

	test('con más de 500 entradas dibuja 500 y resume el resto', async () => {
		const items = Array.from({ length: 620 }, (_, n) => `archivo-${n}.txt`);

		await abrir(items);

		const dibujadas = filas();
		// 500 entradas y una fila final con lo que falta.
		expect(dibujadas).toHaveLength(501);
		expect(dibujadas[0].textContent?.trim()).toBe('archivo-0.txt');
		expect(dibujadas[499].textContent?.trim()).toBe('archivo-499.txt');
		expect(dibujadas[500].textContent).toContain('dialogs.archiveContentDialog.andMore');
	});

	test('con exactamente 500 no agrega la fila de «y más»', async () => {
		await abrir(Array.from({ length: 500 }, (_, n) => `a-${n}`));

		expect(filas()).toHaveLength(500);
		expect(elPanel()?.textContent).not.toContain('dialogs.archiveContentDialog.andMore');
	});

	test('un archivo vacío muestra el estado vacío y ninguna fila', async () => {
		await abrir([]);

		expect(filas()).toHaveLength(0);
		expect(elPanel()?.textContent).toContain('dialogs.archiveContentDialog.empty');
	});
});
