import { describe, expect, test } from 'bun:test';
import { disableWebViewFeatures } from '@/utils/web-view-features';

disableWebViewFeatures();

const press = (init: KeyboardEventInit) => {
	const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
	document.dispatchEvent(event);
	return event.defaultPrevented;
};

describe('búsqueda nativa del navegador', () => {
	test('Ctrl+F se bloquea', () => {
		expect(press({ key: 'f', ctrlKey: true })).toBe(true);
	});

	test('Ctrl+F con Bloq Mayús (key en mayúscula) también se bloquea', () => {
		expect(press({ key: 'F', ctrlKey: true })).toBe(true);
	});

	test('F3 y Ctrl+G, el «buscar siguiente», se bloquean', () => {
		expect(press({ key: 'F3' })).toBe(true);
		expect(press({ key: 'g', ctrlKey: true })).toBe(true);
	});

	test('una tecla cualquiera no se toca', () => {
		expect(press({ key: 'a' })).toBe(false);
	});
});
