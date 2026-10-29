/**
 * El menú del clic derecho sobre los archivos.
 *
 * Las funciones puras que arman sus renglones se prueban directo; lo que vive
 * adentro del composable (`buildMenu`, «Abrir con», las etiquetas) se prueba
 * montándolo y capturando el menú que le entrega al plugin del menú del
 * escritorio, que es lo que ve quien usa el sistema.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { MenuChoice, MenuEntry } from '@vasakgroup/plugin-vsk-contextual-menu';
import * as pluginReal from '@vasakgroup/plugin-vsk-contextual-menu';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, ref } from 'vue';
import {
	actionItem,
	openWithProgram,
	programaItem,
	seccionesDeProgramas,
	terminalTargetPath,
	tidySeparators,
	type UseEntryContextMenuOptions,
	useEntryContextMenu,
} from '@/composables/file-browser/use-entry-context-menu';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useUserStatsStore } from '@/stores/storage/user-stats';
import type { ContextMenuAction, ContextMenuState } from '@/types/file-browser';
import { olvidarTodo, pedidos, responder } from './dobles';
import { archivo, carpeta } from './support/dir-entry';

/**
 * Lo que decide el menú «elegido» y lo que se le mostró.
 *
 * El plugin real queda por debajo: sólo `show` se desvía mientras una prueba
 * pone un `elegir`, así que los demás archivos siguen viendo el menú de verdad.
 */
let elegir: ((items: MenuEntry[]) => MenuChoice | null) | null = null;
let mostrados: MenuEntry[][] = [];

// Se guarda antes de `mock.module`: el espacio de nombres se rebinda al doble.
const useContextMenuReal = pluginReal.useContextMenu;
const moduloReal = { ...pluginReal };

mock.module('@vasakgroup/plugin-vsk-contextual-menu', () => ({
	...moduloReal,
	useContextMenu: () => {
		const real = useContextMenuReal();
		return {
			...real,
			show: async (items: MenuEntry[], ...resto: [never]) => {
				if (!elegir) return real.show(items, ...resto);
				mostrados.push(items);
				return elegir(items);
			},
		};
	},
}));

const t = (clave: string) => clave;

const separador: MenuEntry = { type: 'separator' };
const etiqueta = (label: string): MenuEntry => ({ type: 'label', label });

const programa = (name: string, path: string, campos = {}) => ({
	name,
	path,
	icon: null,
	is_default: false,
	...campos,
});

describe('actionItem', () => {
	test('arma el renglón con el id de la acción, su texto, su ícono y su atajo', () => {
		expect(actionItem('copy', 'Copiar', 'edit-copy', { accelerator: 'Ctrl+C' })).toEqual({
			id: 'action:copy',
			label: 'Copiar',
			icon: 'edit-copy',
			accelerator: 'Ctrl+C',
			danger: undefined,
		});
	});

	test('una acción destructiva sale marcada como peligrosa', () => {
		const item = actionItem('delete-permanently', 'Borrar', 'edit-delete-shred', { danger: true });

		expect(item).toMatchObject({ id: 'action:delete-permanently', danger: true });
	});

	test('sin opciones no lleva atajo ni marca de peligro', () => {
		const item = actionItem('share', 'Compartir', 'emblem-shared');

		expect(item).toMatchObject({ accelerator: undefined, danger: undefined });
	});
});

describe('tidySeparators', () => {
	const a = actionItem('copy', 'a', 'x');
	const b = actionItem('cut', 'b', 'x');

	test('saca los separadores del principio y del final', () => {
		expect(tidySeparators([separador, a, separador])).toEqual([a]);
	});

	test('junta los separadores consecutivos en uno', () => {
		expect(tidySeparators([a, separador, separador, separador, b])).toEqual([a, separador, b]);
	});

	test('deja los separadores que quedan entre dos renglones', () => {
		expect(tidySeparators([a, separador, b])).toEqual([a, separador, b]);
	});

	test('un menú de puros separadores queda vacío', () => {
		expect(tidySeparators([separador, separador])).toEqual([]);
		expect(tidySeparators([])).toEqual([]);
	});

	test('no modifica el arreglo que recibe', () => {
		const entrada = [separador, a, separador];

		tidySeparators(entrada);

		expect(entrada).toHaveLength(3);
	});
});

describe('programaItem', () => {
	test('arma el renglón con la ruta del programa en el id', () => {
		const item = programaItem(programa('Editor', '/usr/bin/editor', { icon: 'accessories-text' }));

		expect(item).toEqual({
			id: 'open-with:/usr/bin/editor',
			label: 'Editor',
			icon: 'accessories-text',
		});
	});

	test('un programa sin ícono usa el genérico', () => {
		expect(programaItem(programa('Editor', '/usr/bin/editor'))).toMatchObject({
			icon: 'text-x-generic',
		});
	});
});

describe('seccionesDeProgramas', () => {
	const vacio = {
		success: true,
		recommended_programs: [],
		other_programs: [],
		default_program: null,
		error: null,
	};

	test('con programa por defecto, sugeridos y otros arma las tres secciones separadas', () => {
		const items = seccionesDeProgramas(
			{
				...vacio,
				default_program: programa('Por defecto', '/d'),
				recommended_programs: [programa('Sugerido', '/s1'), programa('Sugerido 2', '/s2')],
				other_programs: [programa('Otro', '/o')],
			},
			t
		);

		expect(items).toEqual([
			etiqueta('openWith.defaultApp'),
			programaItem(programa('Por defecto', '/d')),
			separador,
			etiqueta('openWith.suggestedApps'),
			programaItem(programa('Sugerido', '/s1')),
			programaItem(programa('Sugerido 2', '/s2')),
			separador,
			etiqueta('openWith.otherApps'),
			programaItem(programa('Otro', '/o')),
		]);
	});

	test('la primera sección no lleva separador arriba', () => {
		const items = seccionesDeProgramas({ ...vacio, other_programs: [programa('Otro', '/o')] }, t);

		expect(items).toEqual([etiqueta('openWith.otherApps'), programaItem(programa('Otro', '/o'))]);
	});

	test('una sección vacía no deja ni etiqueta ni separador', () => {
		const items = seccionesDeProgramas(
			{
				...vacio,
				default_program: programa('Por defecto', '/d'),
				other_programs: [programa('Otro', '/o')],
			},
			t
		);

		expect(items.map((item) => ('label' in item ? item.label : item.type))).toEqual([
			'openWith.defaultApp',
			'Por defecto',
			'separator',
			'openWith.otherApps',
			'Otro',
		]);
	});

	test('sin ningún programa el menú lo dice en un renglón', () => {
		expect(seccionesDeProgramas(vacio, t)).toEqual([etiqueta('openWith.noProgramsFound')]);
	});

	test('sin respuesta del sistema también lo dice', () => {
		expect(seccionesDeProgramas(null, t)).toEqual([etiqueta('openWith.noProgramsFound')]);
	});
});

beforeEach(() => {
	olvidarTodo();
	setActivePinia(createPinia());
	elegir = null;
	mostrados = [];
	// El store arranca con los arreglos del valor por omisión, compartidos entre
	// instancias: sin cambiarlos, lo que una prueba etiqueta lo ve la siguiente.
	const stats = useUserStatsStore();
	stats.userStats.favorites = [];
	stats.userStats.tags = [];
	stats.userStats.taggedItems = [];
});

describe('terminalTargetPath', () => {
	test('para una carpeta devuelve la propia carpeta', async () => {
		expect(await terminalTargetPath([carpeta('docs', { path: '/casa/docs' })])).toBe('/casa/docs');
		expect(pedidos('plugin:path|dirname')).toHaveLength(0);
	});

	test('para un archivo devuelve la carpeta que lo contiene', async () => {
		responder('plugin:path|dirname', () => '/casa');

		expect(await terminalTargetPath([archivo('a.txt', { path: '/casa/a.txt' })])).toBe('/casa');
		expect(pedidos('plugin:path|dirname')[0].argumentos).toEqual({ path: '/casa/a.txt' });
	});

	test('sin entradas no hay destino', async () => {
		expect(await terminalTargetPath([])).toBeNull();
	});

	test('si no se puede resolver la carpeta del archivo, no hay destino', async () => {
		responder('plugin:path|dirname', () => {
			throw new Error('sin ruta');
		});
		const aviso = spyOn(console, 'warn').mockImplementation(() => {});

		expect(await terminalTargetPath([archivo('a.txt')])).toBeNull();
		expect(aviso).toHaveBeenCalled();
		aviso.mockRestore();
	});
});

describe('openWithProgram', () => {
	test('abre cada entrada con el programa elegido', async () => {
		responder('open_with_program', { success: true, error: null });

		await openWithProgram('/usr/bin/editor', [archivo('a.txt'), archivo('b.txt')]);

		expect(pedidos('open_with_program').map((p) => p.argumentos)).toEqual([
			{ filePath: '/casa/a.txt', programPath: '/usr/bin/editor', arguments: [] },
			{ filePath: '/casa/b.txt', programPath: '/usr/bin/editor', arguments: [] },
		]);
	});

	test('corta en la primera entrada que no se pudo abrir', async () => {
		responder('open_with_program', () => ({ success: false, error: 'no se pudo' }));
		const error = spyOn(console, 'error').mockImplementation(() => {});

		await openWithProgram('/p', [archivo('a.txt'), archivo('b.txt'), archivo('c.txt')]);

		expect(pedidos('open_with_program')).toHaveLength(1);
		expect(error).toHaveBeenCalledWith('Failed to open file:', 'no se pudo');
		error.mockRestore();
	});

	test('si el comando revienta, lo anota y no propaga el error', async () => {
		responder('open_with_program', () => {
			throw new Error('caído');
		});
		const error = spyOn(console, 'error').mockImplementation(() => {});

		await openWithProgram('/p', [archivo('a.txt'), archivo('b.txt')]);

		expect(pedidos('open_with_program')).toHaveLength(1);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// El composable montado
// ---------------------------------------------------------------------------

let vista: VueWrapper | null = null;

afterEach(() => {
	vista?.unmount();
	vista = null;
	// El doble de `show` es de todo el proceso (`mock.module`): si queda un
	// `elegir`, el menú real de las pruebas de otros archivos nunca se dibuja.
	elegir = null;
});

interface Montado {
	abrir: (entrada: ReturnType<typeof archivo>) => Promise<void>;
	acciones: ContextMenuAction[];
	abiertosConDialogo: unknown[][];
}

/** Monta el composable con `seleccion` como lo seleccionado. */
function montar(seleccion: ReturnType<typeof archivo>[]): Montado {
	const acciones: ContextMenuAction[] = [];
	const abiertosConDialogo: unknown[][] = [];
	const contextMenu = ref<ContextMenuState>({ targetEntry: null, selectedEntries: [] });
	const opciones: UseEntryContextMenuOptions = {
		contextMenu,
		handleEntryContextMenu: (entry) => {
			contextMenu.value = { targetEntry: entry, selectedEntries: seleccion };
		},
		onAction: (accion) => acciones.push(accion),
		openOpenWithDialog: (entradas) => abiertosConDialogo.push(entradas),
	};
	let abrir!: Montado['abrir'];

	vista = mount(
		defineComponent({
			setup() {
				const { openEntryContextMenu } = useEntryContextMenu(opciones);
				abrir = (entrada) =>
					openEntryContextMenu(entrada, { clientX: 10, clientY: 20 } as MouseEvent);
				return () => h('div');
			},
		})
	);

	return { abrir, acciones, abiertosConDialogo };
}

/** Los ids de lo que hay en el menú, sin separadores, con los submenús abiertos aparte. */
const ids = (items: MenuEntry[]) => items.flatMap((item) => ('id' in item ? [item.id] : []));
const submenu = (items: MenuEntry[], label: string) => {
	const encontrado = items.find((item) => item.type === 'submenu' && item.label.startsWith(label));
	if (encontrado?.type !== 'submenu') throw new Error(`sin submenú ${label}`);
	return encontrado.items;
};

function prepararSistema() {
	responder('get_available_terminals', {
		success: true,
		terminals: [
			{ id: 'konsole', name: 'Konsole', icon: null, isDefault: true },
			{ id: 'xterm', name: 'XTerm', icon: 'utilities-terminal', isDefault: false },
		],
		error: null,
	});
	responder('get_terminal_icons', {});
	responder('get_associated_programs', {
		success: true,
		default_program: programa('Editor', '/usr/bin/editor', { is_default: true }),
		recommended_programs: [programa('Visor', '/usr/bin/visor')],
		other_programs: [programa('Otro', '/usr/bin/otro')],
		error: null,
	});
}

describe('el menú de un archivo', () => {
	test('ofrece las acciones de un archivo, con atajo, en el orden de siempre y sin separadores sueltos', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		const menu = mostrados[0];
		expect(ids(menu)).toEqual([
			'action:rename',
			'action:copy',
			'action:cut',
			'action:copy-path',
			'action:delete',
			'action:delete-permanently',
			'action:share',
			'action:compress',
			'action:toggle-favorite',
			'action:properties',
		]);
		expect(menu[0]).toMatchObject({ icon: 'edit-rename' });
		expect((menu[0] as { accelerator?: string }).accelerator).toBeTruthy();
		// Compartir no tiene atajo; el borrado permanente va en rojo.
		expect(menu.find((i) => 'id' in i && i.id === 'action:share')).toMatchObject({
			accelerator: undefined,
		});
		expect(menu.find((i) => 'id' in i && i.id === 'action:delete-permanently')).toMatchObject({
			danger: true,
		});
		// Nunca empieza ni termina con un separador.
		expect(menu[0].type).not.toBe('separator');
		expect(menu.at(-1)?.type).not.toBe('separator');
	});

	test('una carpeta suma abrir en una pestaña nueva', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir } = montar([carpeta('docs')]);

		await abrir(carpeta('docs'));

		expect(ids(mostrados[0])).toContain('action:open-in-new-tab');
	});

	test('un archivo comprimido ofrece extraer aquí', async () => {
		prepararSistema();
		elegir = () => null;
		const zip = archivo('a.zip', { ext: 'zip' });
		const { abrir } = montar([zip]);

		await abrir(zip);

		expect(ids(mostrados[0])).toContain('action:extract-here');
	});

	test('un archivo comprimido ofrece ver su contenido', async () => {
		prepararSistema();
		elegir = () => null;
		const zip = archivo('a.zip', { ext: 'zip' });
		const { abrir } = montar([zip]);

		await abrir(zip);

		expect(ids(mostrados[0])).toContain('action:list-archive');
	});

	test('un archivo que no es comprimido no ofrece extraer ni ver el contenido', async () => {
		prepararSistema();
		elegir = () => null;
		const texto = archivo('a.txt', { ext: 'txt' });
		const { abrir } = montar([texto]);

		await abrir(texto);

		expect(ids(mostrados[0])).not.toContain('action:list-archive');
		expect(ids(mostrados[0])).not.toContain('action:extract-here');
	});

	test('los .zst y los .cpio también ofrecen extraer y ver el contenido', async () => {
		prepararSistema();
		elegir = () => null;

		for (const entrada of [
			archivo('a.tar.zst', { ext: 'zst' }),
			archivo('a.cpio', { ext: 'cpio' }),
		]) {
			vista?.unmount();
			const { abrir } = montar([entrada]);
			await abrir(entrada);
		}

		expect(mostrados).toHaveLength(2);
		for (const menu of mostrados) {
			expect(ids(menu)).toContain('action:extract-here');
			expect(ids(menu)).toContain('action:list-archive');
		}
	});

	test('ver el contenido no se ofrece sobre varias entradas ni sobre una carpeta', async () => {
		prepararSistema();
		elegir = () => null;
		const a = archivo('a.zip', { ext: 'zip' });
		const b = archivo('b.zip', { ext: 'zip' });
		const una = montar([a, b]);
		await una.abrir(a);
		vista?.unmount();
		const otra = montar([carpeta('docs')]);
		await otra.abrir(carpeta('docs'));

		expect(mostrados).toHaveLength(2);
		for (const menu of mostrados) {
			expect(ids(menu)).not.toContain('action:list-archive');
		}
	});

	test('con algo para pegar y una carpeta seleccionada ofrece pegar', async () => {
		prepararSistema();
		elegir = () => null;
		useClipboardStore().setClipboard('copy', [archivo('x.txt', { path: '/otro/x.txt' })]);
		const { abrir } = montar([carpeta('docs')]);

		await abrir(carpeta('docs'));

		expect(ids(mostrados[0])).toContain('action:paste');
	});

	test('sin nada en el portapapeles no ofrece pegar', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir } = montar([carpeta('docs')]);

		await abrir(carpeta('docs'));

		expect(ids(mostrados[0])).not.toContain('action:paste');
	});

	test('si todo lo seleccionado es favorito ofrece sacarlo de favoritos', async () => {
		prepararSistema();
		elegir = () => null;
		const a = archivo('a.txt');
		useUserStatsStore().userStats.favorites.push({ path: a.path, addedAt: 1 });
		const { abrir } = montar([a]);

		await abrir(a);

		const favorito = mostrados[0].find((i) => 'id' in i && i.id === 'action:toggle-favorite');
		expect(favorito).toMatchObject({ label: 'fileBrowser.actions.removeFromFavorites' });
	});

	test('si no es favorito ofrece agregarlo', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		const favorito = mostrados[0].find((i) => 'id' in i && i.id === 'action:toggle-favorite');
		expect(favorito).toMatchObject({ label: 'fileBrowser.actions.addToFavorites' });
	});

	test('sin selección no arma ningún menú', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir } = montar([]);

		await abrir(archivo('a.txt'));

		expect(mostrados).toHaveLength(0);
	});
});

describe('«Abrir con» del menú', () => {
	test('lista el programa por defecto, los sugeridos y los otros, y cierra con el comando propio', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		const abrirCon = submenu(mostrados[0], 'fileBrowser.actions.openWith');
		expect(ids(abrirCon)).toEqual([
			'open-with:/usr/bin/editor',
			'open-with:/usr/bin/visor',
			'open-with:/usr/bin/otro',
			'open-with:custom',
		]);
	});

	test('sobre una carpeta no ofrece el comando propio', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir } = montar([carpeta('docs')]);

		await abrir(carpeta('docs'));

		expect(ids(submenu(mostrados[0], 'fileBrowser.actions.openWith'))).not.toContain(
			'open-with:custom'
		);
	});

	test('vuelve a abrir el mismo archivo sin preguntarle de nuevo al sistema', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));
		await abrir(archivo('a.txt'));

		expect(pedidos('get_associated_programs')).toHaveLength(1);
	});

	test('si el sistema contesta con error, el submenú muestra ese error', async () => {
		prepararSistema();
		responder('get_associated_programs', { success: false, error: 'sin mimeapps' });
		elegir = () => null;
		const { abrir } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		expect(submenu(mostrados[0], 'fileBrowser.actions.openWith')).toEqual([
			etiqueta('sin mimeapps'),
		]);
	});

	test('si el error no trae texto, usa el mensaje genérico', async () => {
		prepararSistema();
		responder('get_associated_programs', { success: false, error: null });
		elegir = () => null;
		const { abrir } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		expect(submenu(mostrados[0], 'fileBrowser.actions.openWith')).toEqual([
			etiqueta('openWith.failedToLoadPrograms'),
		]);
	});

	test('si el comando revienta, el submenú muestra el error', async () => {
		prepararSistema();
		responder('get_associated_programs', () => {
			throw new Error('caído');
		});
		elegir = () => null;
		const { abrir } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		const [unico] = submenu(mostrados[0], 'fileBrowser.actions.openWith');
		expect(unico).toMatchObject({ type: 'label', label: expect.stringContaining('caído') });
	});

	test('elegir un programa abre las entradas con él', async () => {
		prepararSistema();
		responder('open_with_program', { success: true, error: null });
		elegir = () => ({ id: 'open-with:/usr/bin/visor' });
		const { abrir } = montar([archivo('a.txt'), archivo('b.txt')]);

		await abrir(archivo('a.txt'));

		expect(pedidos('open_with_program').map((p) => p.argumentos.programPath)).toEqual([
			'/usr/bin/visor',
			'/usr/bin/visor',
		]);
	});

	test('elegir el comando propio abre el diálogo', async () => {
		prepararSistema();
		elegir = () => ({ id: 'open-with:custom' });
		const { abrir, abiertosConDialogo } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		expect(abiertosConDialogo).toHaveLength(1);
		expect(pedidos('open_with_program')).toHaveLength(0);
	});
});

describe('lo que pasa al elegir en el menú', () => {
	test('elegir una acción se la pasa a quien abrió el menú', async () => {
		prepararSistema();
		elegir = () => ({ id: 'action:copy' });
		const { abrir, acciones } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		expect(acciones).toEqual(['copy']);
	});

	test('cerrar el menú sin elegir no hace nada', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir, acciones } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		expect(acciones).toEqual([]);
		expect(pedidos('open_terminal')).toHaveLength(0);
	});

	test('elegir una terminal sobre un archivo la abre en la carpeta que lo contiene', async () => {
		prepararSistema();
		responder('plugin:path|dirname', () => '/casa');
		responder('open_terminal', { success: true, error: null });
		elegir = () => ({ id: 'terminal:xterm' });
		const { abrir } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		expect(pedidos('open_terminal')[0].argumentos).toEqual({
			directoryPath: '/casa',
			terminalId: 'xterm',
			asAdmin: false,
		});
	});

	test('con Shift apretado al elegir la terminal se abre como administrador', async () => {
		prepararSistema();
		responder('open_terminal', { success: true, error: null });
		elegir = () => {
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
			return { id: 'terminal:xterm' };
		};
		const { abrir } = montar([carpeta('docs', { path: '/casa/docs' })]);

		await abrir(carpeta('docs'));

		expect(pedidos('open_terminal')[0].argumentos).toMatchObject({ asAdmin: true });
	});

	test('soltar Shift, o perder el foco de la ventana, deja de pedir administrador', async () => {
		prepararSistema();
		responder('open_terminal', { success: true, error: null });
		let paso = 0;
		elegir = () => {
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
			window.dispatchEvent(
				paso++ === 0 ? new KeyboardEvent('keyup', { key: 'Shift' }) : new Event('blur')
			);
			return { id: 'terminal:xterm' };
		};
		const { abrir } = montar([carpeta('docs', { path: '/casa/docs' })]);

		await abrir(carpeta('docs'));
		await abrir(carpeta('docs'));

		expect(pedidos('open_terminal').map((p) => p.argumentos.asAdmin)).toEqual([false, false]);
	});

	test('el submenú de terminales lista las instaladas y marca la predeterminada', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir } = montar([carpeta('docs')]);

		await abrir(carpeta('docs'));

		const terminales = submenu(mostrados[0], 'terminal.openInTerminal');
		expect(ids(terminales)).toEqual(['terminal:konsole', 'terminal:xterm']);
		expect(terminales.find((i) => 'id' in i && i.id === 'terminal:konsole')).toMatchObject({
			label: 'Konsole (terminal.defaultLabel)',
			icon: 'utilities-terminal',
		});
	});

	test('sin terminales instaladas el submenú lo dice', async () => {
		prepararSistema();
		responder('get_available_terminals', { success: true, terminals: [], error: null });
		elegir = () => null;
		const { abrir } = montar([carpeta('docs')]);

		await abrir(carpeta('docs'));

		expect(submenu(mostrados[0], 'terminal.openInTerminal')).toEqual([
			etiqueta('terminal.noTerminalsFound'),
		]);
	});

	test('si las terminales no cargan, el submenú muestra el error', async () => {
		prepararSistema();
		responder('get_available_terminals', { success: false, terminals: [], error: 'sin acceso' });
		elegir = () => null;
		const { abrir } = montar([carpeta('docs')]);

		await abrir(carpeta('docs'));

		expect(submenu(mostrados[0], 'terminal.openInTerminal')).toEqual([etiqueta('sin acceso')]);
	});
});

describe('las etiquetas del menú', () => {
	test('sin etiquetas creadas el submenú lo dice', async () => {
		prepararSistema();
		elegir = () => null;
		const { abrir } = montar([archivo('a.txt')]);

		await abrir(archivo('a.txt'));

		expect(submenu(mostrados[0], 'fileBrowser.actions.tags')).toEqual([
			etiqueta('fileBrowser.actions.noTags'),
		]);
	});

	test('las etiquetas comunes a toda la selección salen tildadas', async () => {
		prepararSistema();
		elegir = () => null;
		const [a, b] = [archivo('a.txt'), archivo('b.txt')];
		const stats = useUserStatsStore();
		stats.userStats.tags.push(
			{ id: 'roja', name: 'Roja', color: '#f00' },
			{ id: 'azul', name: 'Azul', color: '#00f' }
		);
		stats.userStats.taggedItems.push(
			{ path: a.path, tagIds: ['roja', 'azul'], addedAt: 1, isFile: true },
			{ path: b.path, tagIds: ['roja'], addedAt: 1, isFile: true }
		);
		const { abrir } = montar([a, b]);

		await abrir(a);

		const casillas = submenu(mostrados[0], 'fileBrowser.actions.tags');
		expect(casillas).toEqual([
			{ type: 'checkbox', id: 'tag:roja', label: 'Roja', checked: true },
			{ type: 'checkbox', id: 'tag:azul', label: 'Azul', checked: false },
		]);
	});

	test('elegir una etiqueta que no estaba se la pone a todas las entradas, en paralelo', async () => {
		prepararSistema();
		const [a, b] = [archivo('a.txt'), archivo('b.txt')];
		const stats = useUserStatsStore();
		stats.userStats.tags.push({ id: 'roja', name: 'Roja', color: '#f00' });
		// Si se etiquetara de a una, la segunda llamada no empezaría hasta que
		// terminara la primera: acá la primera no termina hasta ver la segunda.
		const empezadas: string[] = [];
		let soltar!: () => void;
		const compuerta = new Promise<void>((resolver) => {
			soltar = resolver;
		});
		// `spyOn` no engancha las acciones de pinia: se reemplaza a mano.
		const llamadas: unknown[][] = [];
		stats.addTagToItem = async (...argumentos: [string, string, boolean?]) => {
			llamadas.push(argumentos);
			empezadas.push(argumentos[0]);
			if (empezadas.length === 2) soltar();
			await compuerta;
		};
		elegir = () => ({ id: 'tag:roja', checked: true });
		const { abrir } = montar([a, b]);

		await abrir(a);

		expect(empezadas).toEqual([a.path, b.path]);
		expect(llamadas[0]).toEqual([a.path, 'roja', true]);
	});

	test('elegir una etiqueta que ya tenían todas se la saca a todas', async () => {
		prepararSistema();
		const [a, b] = [archivo('a.txt'), archivo('b.txt')];
		const stats = useUserStatsStore();
		stats.userStats.tags.push({ id: 'roja', name: 'Roja', color: '#f00' });
		stats.userStats.taggedItems.push(
			{ path: a.path, tagIds: ['roja'], addedAt: 1, isFile: true },
			{ path: b.path, tagIds: ['roja'], addedAt: 1, isFile: true }
		);
		elegir = () => ({ id: 'tag:roja', checked: false });
		const { abrir } = montar([a, b]);

		await abrir(a);

		expect(stats.taggedItems).toEqual([]);
	});
});
