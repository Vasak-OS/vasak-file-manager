import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createPinia, setActivePinia } from 'pinia';
import { type ShortcutDefinition, useShortcutsStore } from '@/stores/runtime/shortcuts';
import type { ShortcutId } from '@/types/shortcut';

type Esperado = {
	id: ShortcutId;
	labelKey: string;
	keys: { ctrl?: boolean; alt?: boolean; shift?: boolean; key: string };
	/** Evento que el teclado real produce para la combinación. */
	init: KeyboardEventInit;
};

const NUEVOS: Esperado[] = [
	{
		id: 'newFolder',
		labelKey: 'shortcuts.createNewFolder',
		keys: { ctrl: true, shift: true, key: 'n' },
		init: { key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true },
	},
	{
		id: 'closeTab',
		labelKey: 'shortcuts.closeCurrentTab',
		keys: { ctrl: true, key: 'w' },
		init: { key: 'w', code: 'KeyW', ctrlKey: true },
	},
	{
		id: 'nextTab',
		labelKey: 'shortcuts.switchToNextTab',
		keys: { ctrl: true, key: 'Tab' },
		init: { key: 'Tab', code: 'Tab', ctrlKey: true },
	},
	{
		id: 'previousTab',
		labelKey: 'shortcuts.switchToPreviousTab',
		keys: { ctrl: true, shift: true, key: 'Tab' },
		init: { key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true },
	},
	{
		id: 'reload',
		labelKey: 'shortcuts.reloadDirectory',
		keys: { key: 'F5' },
		init: { key: 'F5', code: 'F5' },
	},
	{
		id: 'goUp',
		labelKey: 'shortcuts.navigateToParentDirectory',
		keys: { alt: true, key: 'ArrowUp' },
		init: { key: 'ArrowUp', code: 'ArrowUp', altKey: true },
	},
	{
		id: 'goBackHistory',
		labelKey: 'shortcuts.navigateBackInHistory',
		keys: { alt: true, key: 'ArrowLeft' },
		init: { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true },
	},
	{
		id: 'goForwardHistory',
		labelKey: 'shortcuts.navigateForwardInHistory',
		keys: { alt: true, key: 'ArrowRight' },
		init: { key: 'ArrowRight', code: 'ArrowRight', altKey: true },
	},
	{
		id: 'goHome',
		labelKey: 'shortcuts.navigateToHome',
		keys: { alt: true, key: 'Home' },
		init: { key: 'Home', code: 'Home', altKey: true },
	},
	{
		id: 'zoomIn',
		labelKey: 'shortcuts.zoomIn',
		keys: { ctrl: true, key: '=' },
		init: { key: '=', code: 'Equal', ctrlKey: true },
	},
	{
		id: 'zoomOut',
		labelKey: 'shortcuts.zoomOut',
		keys: { ctrl: true, key: '-' },
		init: { key: '-', code: 'Minus', ctrlKey: true },
	},
	{
		id: 'zoomReset',
		labelKey: 'shortcuts.zoomReset',
		keys: { ctrl: true, key: '0' },
		init: { key: '0', code: 'Digit0', ctrlKey: true },
	},
];

const teclado = (init: KeyboardEventInit) =>
	new KeyboardEvent('keydown', { cancelable: true, ...init });

function combinacion(definicion: ShortcutDefinition): string {
	const k = definicion.defaultKeys;
	// Ctrl y Meta valen lo mismo para `matchesShortcut`.
	return [
		k.ctrl || k.meta ? 'ctrl' : '',
		k.alt ? 'alt' : '',
		k.shift ? 'shift' : '',
		k.key.toLowerCase(),
	]
		.filter(Boolean)
		.join('+');
}

/** Las claves de la sección `shortcuts:` de un .yml (lector de sangría, como en claves-de-traduccion). */
function clavesDeAtajos(archivo: string): Set<string> {
	const claves = new Set<string>();
	let dentro = false;
	for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
		if (/^shortcuts:\s*$/.test(linea)) {
			dentro = true;
			continue;
		}
		if (!dentro) continue;
		if (/^\S/.test(linea)) break;
		const m = linea.match(/^ {2}([A-Za-z0-9_]+):\s*\S/);
		if (m) claves.add(`shortcuts.${m[1]}`);
	}
	return claves;
}

describe('atajos comunes de un gestor de archivos: definiciones', () => {
	let store: ReturnType<typeof useShortcutsStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useShortcutsStore();
	});

	for (const esperado of NUEVOS) {
		test(`${esperado.id} está definido con su combinación en el navegador`, () => {
			const definicion = store.getShortcutDefinition(esperado.id);

			expect(definicion).toBeDefined();
			expect(definicion?.defaultKeys).toEqual(esperado.keys);
			expect(definicion?.labelKey).toBe(esperado.labelKey);
			expect(definicion?.scope).toBe('navigator');
		});
	}

	test('ninguna combinación se repite dentro del navegador ni entre navegador y global', () => {
		const vistas = new Map<string, ShortcutId>();
		const repetidas: string[] = [];

		for (const definicion of store.definitions) {
			if (definicion.scope === 'settings') continue;
			const clave = combinacion(definicion);
			const previa = vistas.get(clave);
			if (previa) repetidas.push(`${clave}: ${previa} y ${definicion.id}`);
			vistas.set(clave, definicion.id);
		}

		expect(repetidas).toEqual([]);
	});

	test('ningún atajo nuevo pisa la combinación de uno de otro ámbito', () => {
		const nuevos = new Set(NUEVOS.map((n) => n.id));
		const otros = store.definitions.filter((d) => !nuevos.has(d.id));

		for (const nuevo of NUEVOS) {
			const definicion = store.getShortcutDefinition(nuevo.id) as ShortcutDefinition;
			const choque = otros.find((d) => combinacion(d) === combinacion(definicion));
			expect(choque?.id).toBeUndefined();
		}
	});

	test('cada etiqueta de atajo existe en inglés y en español', () => {
		const en = clavesDeAtajos('src-tauri/locales/en.yml');
		const es = clavesDeAtajos('src-tauri/locales/es.yml');
		const faltan: string[] = [];

		for (const definicion of store.definitions) {
			if (!en.has(definicion.labelKey)) faltan.push(`en: ${definicion.labelKey}`);
			if (!es.has(definicion.labelKey)) faltan.push(`es: ${definicion.labelKey}`);
		}

		expect(faltan).toEqual([]);
	});
});

describe('atajos comunes de un gestor de archivos: disparo', () => {
	let store: ReturnType<typeof useShortcutsStore>;
	let disparados: ShortcutId[];

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useShortcutsStore();
		disparados = [];
		for (const { id } of NUEVOS) {
			store.registerHandler(id, () => {
				disparados.push(id);
			});
		}
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	for (const esperado of NUEVOS) {
		test(`${esperado.id} dispara su manejador y consume la tecla`, async () => {
			const evento = teclado(esperado.init);

			const consumido = await store.handleKeydown(evento);

			expect(disparados).toEqual([esperado.id]);
			expect(consumido).toBe(true);
			expect(evento.defaultPrevented).toBe(true);
		});

		test(`${esperado.id} no dispara con el foco en un campo de texto`, async () => {
			document.body.innerHTML = '<input id="campo" />';
			(document.getElementById('campo') as HTMLInputElement).focus();

			await store.handleKeydown(teclado(esperado.init));

			expect(disparados).toEqual([]);
		});

		test(`${esperado.id} no dispara con un diálogo modal abierto`, async () => {
			document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';

			await store.handleKeydown(teclado(esperado.init));

			expect(disparados).toEqual([]);
		});
	}

	test('Ctrl+Tab y Ctrl+Shift+Tab no se confunden entre sí', async () => {
		await store.handleKeydown(teclado({ key: 'Tab', code: 'Tab', ctrlKey: true }));
		await store.handleKeydown(teclado({ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true }));

		expect(disparados).toEqual(['nextTab', 'previousTab']);
	});
});
