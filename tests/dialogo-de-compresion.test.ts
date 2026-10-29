/**
 * El diálogo de comprimir (#149): la clave y los formatos nuevos.
 *
 * El campo de clave sólo aparece con 7z, que es el único formato de la lista que
 * cifra; la clave sale en el `confirm` sólo en ese caso, y no se queda en el
 * diálogo al cerrarlo.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { forgetThemeIcons, SelectField } from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import CompressDialogComponent from '@/components/dialogs/CompressDialogComponent.vue';
import { olvidarTodo } from './dobles';

let vista: VueWrapper | null = null;

const elPanel = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const campoDeClave = () => elPanel()?.querySelector<HTMLInputElement>('#compress-password-input');

/** Monta cerrado y abre, que es como lo usa la aplicación (el nombre se llena en un `watch`). */
async function abrir() {
	vista = mount(CompressDialogComponent, {
		props: { open: false, defaultName: 'datos', itemCount: 2 },
		attachTo: document.body,
	});
	await vista.setProps({ open: true });
	await nextTick();
	await nextTick();
	return vista;
}

async function elegirFormato(formato: string) {
	vista?.findComponent(SelectField).vm.$emit('update:modelValue', formato);
	await nextTick();
}

async function escribirClave(clave: string) {
	const campo = campoDeClave() as HTMLInputElement;
	campo.value = clave;
	campo.dispatchEvent(new Event('input'));
	await nextTick();
}

async function comprimir() {
	const boton = [...(elPanel()?.querySelectorAll('button') ?? [])].find(
		(b) => b.textContent?.trim() === 'dialogs.compressDialog.compress'
	);
	boton?.click();
	await nextTick();
	return vista?.emitted('confirm') ?? [];
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

describe('el diálogo de comprimir', () => {
	test('ofrece tar.zst y cpio entre los formatos', async () => {
		await abrir();

		const opciones = vista?.findComponent(SelectField).props('options') as { value: string }[];

		expect(opciones.map((opcion) => opcion.value)).toEqual([
			'zip',
			'tar.gz',
			'tar.xz',
			'tar.bz2',
			'tar.zst',
			'tar',
			'cpio',
			'7z',
		]);
	});

	test('el campo de clave sólo aparece con 7z', async () => {
		await abrir();
		expect(campoDeClave()).toBeNull();

		await elegirFormato('7z');
		expect(campoDeClave()).not.toBeNull();

		await elegirFormato('tar.zst');
		expect(campoDeClave()).toBeNull();
	});

	test('con 7z y una clave escrita, el confirm la lleva', async () => {
		await abrir();
		await elegirFormato('7z');
		await escribirClave('clave secreta ');

		const confirmaciones = await comprimir();

		// Sin trim: los espacios de la clave cuentan.
		expect(confirmaciones).toEqual([['datos', '7z', 'clave secreta ']]);
	});

	test('con 7z y sin clave, el confirm no lleva ninguna', async () => {
		await abrir();
		await elegirFormato('7z');

		const confirmaciones = await comprimir();

		expect(confirmaciones).toEqual([['datos', '7z', undefined]]);
	});

	test('si se escribió una clave y después se cambia de formato, no viaja', async () => {
		await abrir();
		await elegirFormato('7z');
		await escribirClave('clave');
		await elegirFormato('zip');

		const confirmaciones = await comprimir();

		expect(confirmaciones).toEqual([['datos', 'zip', undefined]]);
	});

	test('cerrar el diálogo borra la clave: al reabrir el campo está vacío', async () => {
		await abrir();
		await elegirFormato('7z');
		await escribirClave('clave-que-no-debe-quedar');
		expect(campoDeClave()?.value).toBe('clave-que-no-debe-quedar');

		await vista?.setProps({ open: false });
		await nextTick();
		await vista?.setProps({ open: true });
		await nextTick();
		await nextTick();

		expect(campoDeClave()?.value).toBe('');
		expect(vista?.emitted('cancel')).toHaveLength(1);
	});
});
