import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { useToast } from '@/components/ui/toast/toaster';
import { useContextMenuItems } from '@/composables/file-browser/use-context-menu-items';
import { useFileBrowserSelection } from '@/composables/file-browser/use-file-browser-selection';
import { useNavigatorStore } from '@/stores/runtime/navigator';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import type { DirEntry } from '@/types/dir-entry';
import type { ShortcutId, ShortcutKeys } from '@/types/shortcut';
import { makeDirEntry, nombres } from './support/dir-entry';

const entrada = (name: string, campos: Partial<DirEntry> = {}): DirEntry =>
	makeDirEntry({ name, ...campos });

/** Instancia el composable de selección con las entradas dadas. */
function montar(entradas: DirEntry[]) {
	const entriesRef = ref(entradas);
	const avisos: DirEntry[][] = [];
	const seleccion = useFileBrowserSelection(
		entriesRef,
		ref('/casa'),
		(elegidas) => avisos.push([...elegidas]),
		() => {},
		() => {}
	);
	return { ...seleccion, avisos };
}

/** Deja correr las promesas pendientes (el copiado al portapapeles es asíncrono). */
const vaciarPromesas = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

const teclado = (init: KeyboardEventInit) =>
	new KeyboardEvent('keydown', { cancelable: true, ...init });

/** Comprueba las teclas de un atajo y que el evento dispara su manejador una vez. */
async function disparaAtajo(
	id: ShortcutId,
	keys: ShortcutKeys,
	init: KeyboardEventInit
): Promise<KeyboardEvent> {
	const tienda = useShortcutsStore();
	expect(tienda.getShortcutDefinition(id)?.defaultKeys).toEqual(keys);

	let disparos = 0;
	tienda.registerHandler(id, () => {
		disparos++;
	});
	const evento = teclado(init);
	await tienda.handleKeydown(evento);

	expect(disparos).toBe(1);
	return evento;
}

beforeEach(() => {
	setActivePinia(createPinia());
});

describe('copiar ruta (#137)', () => {
	let copiado: string[];
	let fallar: boolean;
	const portapapelesOriginal = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

	beforeEach(() => {
		copiado = [];
		fallar = false;
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: async (texto: string) => {
					if (fallar) throw new Error('sin portapapeles');
					copiado.push(texto);
				},
			},
		});
		useToast().toasts.value.clear();
	});

	afterEach(() => {
		if (portapapelesOriginal) Object.defineProperty(navigator, 'clipboard', portapapelesOriginal);
		else Reflect.deleteProperty(navigator, 'clipboard');
	});

	test('el menú contextual copia las rutas absolutas, una por línea', async () => {
		const { contextMenu, handleContextMenuAction } = montar([]);
		contextMenu.value.selectedEntries = [entrada('a.txt'), entrada('b', { is_dir: true })];

		handleContextMenuAction('copy-path');
		await vaciarPromesas();

		expect(copiado).toEqual(['/casa/a.txt\n/casa/b']);
	});

	test('con una sola entrada copia su ruta sin salto de línea', async () => {
		const { contextMenu, handleContextMenuAction } = montar([]);
		contextMenu.value.selectedEntries = [entrada('solo.txt')];

		handleContextMenuAction('copy-path');
		await vaciarPromesas();

		expect(copiado).toEqual(['/casa/solo.txt']);
	});

	test('el atajo copia la ruta de la selección actual', async () => {
		const a = entrada('a.txt');
		const b = entrada('b.txt');
		const { selectAll, copySelectedPaths } = montar([a, b]);
		selectAll();

		copySelectedPaths();
		await vaciarPromesas();

		expect(copiado).toEqual(['/casa/a.txt\n/casa/b.txt']);
	});

	test('sin selección no toca el portapapeles', async () => {
		const { copySelectedPaths } = montar([entrada('a.txt')]);

		copySelectedPaths();
		await vaciarPromesas();

		expect(copiado).toEqual([]);
		expect(useToast().toasts.value.size).toBe(0);
	});

	/** Copia la ruta de una entrada y devuelve los avisos [tipo, título] que quedaron. */
	async function avisosAlCopiar() {
		const { contextMenu, handleContextMenuAction } = montar([]);
		contextMenu.value.selectedEntries = [entrada('a.txt')];

		handleContextMenuAction('copy-path');
		await vaciarPromesas();

		return [...useToast().toasts.value.values()].map((aviso) => [aviso.kind, aviso.title]);
	}

	test('avisa que la ruta se copió', async () => {
		expect(await avisosAlCopiar()).toEqual([['success', 'notifications.pathCopied']]);
	});

	test('si el portapapeles falla avisa del error en vez de callar', async () => {
		fallar = true;
		expect(await avisosAlCopiar()).toEqual([['error', 'notifications.pathCopyFailed']]);
	});

	test('el menú ofrece «copiar ruta» para uno o varios, archivos o carpetas', () => {
		const una = ref([entrada('a.txt')]);
		const varias = ref([entrada('a.txt'), entrada('b', { is_dir: true })]);

		expect(useContextMenuItems(una).isActionVisible('copy-path')).toBe(true);
		expect(useContextMenuItems(varias).isActionVisible('copy-path')).toBe(true);
		expect(useContextMenuItems(ref([])).isActionVisible('copy-path')).toBe(false);
	});

	test('Ctrl+Shift+C está definido y dispara su manejador', async () => {
		const evento = await disparaAtajo(
			'copyPath',
			{ ctrl: true, shift: true, key: 'c' },
			{ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true }
		);
		expect(evento.defaultPrevented).toBe(true);
	});
});

describe('propiedades (#138)', () => {
	test('pedir abrir el panel incrementa el contador cada vez', () => {
		const navegador = useNavigatorStore();
		expect(navegador.infoPanelOpenRequests).toBe(0);

		navegador.requestOpenInfoPanel();
		navegador.requestOpenInfoPanel();

		expect(navegador.infoPanelOpenRequests).toBe(2);
	});

	test('«Propiedades» del menú contextual pide abrir el panel de información', () => {
		const navegador = useNavigatorStore();
		const { contextMenu, handleContextMenuAction } = montar([]);
		contextMenu.value.selectedEntries = [entrada('a.txt')];

		handleContextMenuAction('properties');

		expect(navegador.infoPanelOpenRequests).toBe(1);
	});

	test('el menú ofrece «propiedades» para uno o varios, y no sin selección', () => {
		expect(useContextMenuItems(ref([entrada('a')])).isActionVisible('properties')).toBe(true);
		expect(
			useContextMenuItems(ref([entrada('a'), entrada('b')])).isActionVisible('properties')
		).toBe(true);
		expect(useContextMenuItems(ref([])).isActionVisible('properties')).toBe(false);
	});

	test('Alt+Enter está definido y dispara su manejador', async () => {
		const evento = await disparaAtajo(
			'showProperties',
			{ alt: true, key: 'Enter' },
			{ key: 'Enter', code: 'Enter', altKey: true }
		);
		expect(evento.defaultPrevented).toBe(true);
	});
});

describe('invertir selección (#136)', () => {
	const a = entrada('a.txt');
	const b = entrada('b.txt');
	const c = entrada('c.txt');
	const d = entrada('d.txt');

	test('selecciona lo que no estaba seleccionado y suelta lo que sí', () => {
		const { invertSelection, selectedEntries } = montar([a, b, c, d]);
		selectedEntries.value = [a, c];

		invertSelection();

		expect(nombres(selectedEntries.value)).toEqual(['b.txt', 'd.txt']);
	});

	test('con la selección vacía selecciona todo', () => {
		const { invertSelection, selectedEntries } = montar([a, b, c]);

		invertSelection();

		expect(nombres(selectedEntries.value)).toEqual(['a.txt', 'b.txt', 'c.txt']);
	});

	test('con todo seleccionado deja la selección vacía', () => {
		const { selectAll, invertSelection, selectedEntries, lastSelectedEntry } = montar([a, b]);
		selectAll();

		invertSelection();

		expect(selectedEntries.value).toEqual([]);
		expect(lastSelectedEntry.value).toBeNull();
	});

	test('invertir dos veces devuelve la selección original', () => {
		const { invertSelection, selectedEntries } = montar([a, b, c, d]);
		selectedEntries.value = [b];

		invertSelection();
		invertSelection();

		expect(nombres(selectedEntries.value)).toEqual(['b.txt']);
	});

	test('avisa a quien escucha la selección con el resultado', () => {
		const { invertSelection, selectedEntries, avisos } = montar([a, b]);
		selectedEntries.value = [a];

		invertSelection();

		expect(nombres(avisos[avisos.length - 1])).toEqual(['b.txt']);
	});

	test('Ctrl+Shift+I está definido y dispara su manejador', async () => {
		await disparaAtajo(
			'invertSelection',
			{ ctrl: true, shift: true, key: 'i' },
			{ key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true }
		);
	});
});

describe('seleccionar por patrón (#136)', () => {
	const entradas = [
		entrada('foto.jpg'),
		entrada('FOTO2.JPG'),
		entrada('nota.txt'),
		entrada('foo1'),
		entrada('foo12'),
		entrada('fooX'),
		entrada('a.b'),
		entrada('axb'),
		entrada('datos (1).csv'),
	];

	function elegir(patron: string) {
		const { selectByPattern, selectedEntries } = montar(entradas);
		selectByPattern(patron);
		return nombres(selectedEntries.value);
	}

	test('«*.jpg» selecciona sólo los .jpg, sin distinguir mayúsculas', () => {
		expect(elegir('*.jpg')).toEqual(['foto.jpg', 'FOTO2.JPG']);
	});

	test('«foo?» matchea foo1 y fooX pero no foo12', () => {
		expect(elegir('foo?')).toEqual(['foo1', 'fooX']);
	});

	test('el patrón está anclado: no matchea en medio del nombre', () => {
		expect(elegir('oto')).toEqual([]);
		expect(elegir('nota')).toEqual([]);
		expect(elegir('nota.tx')).toEqual([]);
	});

	test('un punto en el patrón es literal, no un comodín', () => {
		expect(elegir('a.b')).toEqual(['a.b']);
	});

	test('los paréntesis y otros caracteres de regex se toman literales', () => {
		expect(elegir('datos (1).csv')).toEqual(['datos (1).csv']);
		expect(elegir('*(1)*')).toEqual(['datos (1).csv']);
	});

	test('un patrón vacío o de espacios no cambia la selección', () => {
		const { selectByPattern, selectedEntries, avisos } = montar(entradas);
		selectedEntries.value = [entradas[2]];
		const avisosAntes = avisos.length;

		selectByPattern('');
		selectByPattern('   ');

		expect(nombres(selectedEntries.value)).toEqual(['nota.txt']);
		expect(avisos.length).toBe(avisosAntes);
	});

	test('reemplaza la selección anterior en vez de sumarse a ella', () => {
		const { selectByPattern, selectedEntries } = montar(entradas);
		selectedEntries.value = [entradas[2]];

		selectByPattern('*.jpg');

		expect(nombres(selectedEntries.value)).toEqual(['foto.jpg', 'FOTO2.JPG']);
	});

	test('un patrón sin coincidencias deja la selección vacía', () => {
		expect(elegir('*.zip')).toEqual([]);
	});

	test('Ctrl+S está definido y dispara su manejador', async () => {
		await disparaAtajo(
			'selectByPattern',
			{ ctrl: true, key: 's' },
			{ key: 's', code: 'KeyS', ctrlKey: true }
		);
	});

	test('varios comodines seguidos equivalen a uno (no cuelga)', () => {
		// `**` colapsa a un solo `.*`: sin eso, un patrón con muchos `*` dispara
		// backtracking exponencial (ReDoS) en el hilo de la interfaz.
		expect(elegir('***.jpg')).toEqual(elegir('*.jpg'));
		expect(elegir('**********z')).toEqual([]);
	});
});
