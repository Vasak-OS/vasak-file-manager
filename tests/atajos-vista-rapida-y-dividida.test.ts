import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import type { ShortcutId } from '@/types/shortcut';

const teclado = (init: KeyboardEventInit) =>
	new KeyboardEvent('keydown', { cancelable: true, ...init });

const F3 = { key: 'F3', code: 'F3' };
const ESPACIO = { key: ' ', code: 'Space' };

describe('F3 alterna la vista dividida y Espacio abre la vista rápida', () => {
	let store: ReturnType<typeof useShortcutsStore>;
	let disparados: ShortcutId[];

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useShortcutsStore();
		disparados = [];
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	test('toggleSplitView está definido con F3 en el navegador', () => {
		const definicion = store.getShortcutDefinition('toggleSplitView');

		expect(definicion?.defaultKeys).toEqual({ key: 'F3' });
		expect(definicion?.scope).toBe('navigator');
	});

	test('toggleQuickView está definido con Espacio y exige un elemento seleccionado', () => {
		const definicion = store.getShortcutDefinition('toggleQuickView');

		expect(definicion?.defaultKeys).toEqual({ key: ' ' });
		expect(definicion?.scope).toBe('navigator');
		expect(definicion?.conditions.dirItemIsSelected).toBe(true);
	});

	test('F3 dispara toggleSplitView y consume la tecla', async () => {
		store.registerHandler('toggleSplitView', () => {
			disparados.push('toggleSplitView');
		});
		const evento = teclado(F3);

		const consumido = await store.handleKeydown(evento);

		expect(disparados).toEqual(['toggleSplitView']);
		expect(consumido).toBe(true);
		expect(evento.defaultPrevented).toBe(true);
	});

	test('Espacio dispara toggleQuickView cuando hay una selección', async () => {
		store.registerHandler(
			'toggleQuickView',
			() => {
				disparados.push('toggleQuickView');
			},
			{ checkItemSelected: () => true }
		);

		await store.handleKeydown(teclado(ESPACIO));

		expect(disparados).toEqual(['toggleQuickView']);
	});

	test('Espacio no hace nada sin una selección', async () => {
		store.registerHandler(
			'toggleQuickView',
			() => {
				disparados.push('toggleQuickView');
			},
			{ checkItemSelected: () => false }
		);

		await store.handleKeydown(teclado(ESPACIO));

		expect(disparados).toEqual([]);
	});

	test('Espacio no dispara con el foco en un campo de texto', async () => {
		document.body.innerHTML = '<input id="campo" />';
		(document.getElementById('campo') as HTMLInputElement).focus();
		store.registerHandler(
			'toggleQuickView',
			() => {
				disparados.push('toggleQuickView');
			},
			{ checkItemSelected: () => true }
		);

		await store.handleKeydown(teclado(ESPACIO));

		expect(disparados).toEqual([]);
	});

	test('F3 no dispara con un diálogo modal abierto', async () => {
		document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
		store.registerHandler('toggleSplitView', () => {
			disparados.push('toggleSplitView');
		});

		await store.handleKeydown(teclado(F3));

		expect(disparados).toEqual([]);
	});
});
