import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';

const ctrlH = () => new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', ctrlKey: true });

describe('atajos con diálogos en pantalla', () => {
	let llamadas = 0;
	let store: ReturnType<typeof useShortcutsStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useShortcutsStore();
		llamadas = 0;
		store.registerHandler('toggleHiddenFiles', () => {
			llamadas++;
		});
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	test('un popover oculto y montado no bloquea Ctrl+H', async () => {
		document.body.innerHTML =
			'<div inert style="display: none"><div role="dialog" aria-modal="false"></div></div>';

		await store.handleKeydown(ctrlH());

		expect(llamadas).toBe(1);
	});

	test('un diálogo modal visible bloquea Ctrl+H', async () => {
		document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';

		await store.handleKeydown(ctrlH());

		expect(llamadas).toBe(0);
	});

	test('un diálogo sin aria-modal visible también bloquea Ctrl+H', async () => {
		document.body.innerHTML = '<div role="dialog"></div>';

		await store.handleKeydown(ctrlH());

		expect(llamadas).toBe(0);
	});
});
