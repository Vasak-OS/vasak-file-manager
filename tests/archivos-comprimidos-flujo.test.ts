/**
 * Compresión y extracción avanzadas (#149): lo que la ventana le pide al backend
 * y cómo reacciona a sus centinelas de cifrado.
 *
 * Comprimir, extraer y listar son del backend (probado en Rust, con las
 * herramientas de verdad). Lo que se prueba acá es el cableado: que la clave
 * sólo viaje con el formato que cifra, que `ENCRYPTED` pida la clave y reintente,
 * que `WRONG_PASSWORD` la vuelva a pedir con el aviso, y que la clave no se
 * quede en el estado una vez usada.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { useToast } from '@/components/ui/toast/toaster';
import { useFileBrowserSelection } from '@/composables/file-browser/use-file-browser-selection';
import type { DirEntry } from '@/types/dir-entry';
import type { ArchiveFormat, ContextMenuAction } from '@/types/file-browser';
import { olvidarTodo, pedidos, responder } from './dobles';
import { archivo } from './support/dir-entry';

function montar(entradas: DirEntry[]) {
	const seleccion = useFileBrowserSelection(
		ref(entradas),
		ref('/casa'),
		() => {},
		() => {},
		() => {}
	);

	/** Lo que hace quien usa el sistema: clic derecho sobre la entrada y elegir la acción. */
	async function ejecutar(accion: ContextMenuAction, entrada: DirEntry) {
		seleccion.handleEntryContextMenu(entrada);
		seleccion.handleContextMenuAction(accion);
		await flushPromises();
	}

	return { ...seleccion, ejecutar };
}

const avisos = () =>
	[...useToast().toasts.value.values()].map((aviso) => ({
		kind: aviso.kind,
		title: aviso.title,
		description: aviso.description,
	}));

/** Un archivo comprimido de la carpeta `/casa`. */
const comprimido = (nombre = 'caja.7z') => archivo(nombre, { ext: nombre.split('.').pop() });

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	useToast().toasts.value.clear();
});

describe('comprimir: la clave sólo viaja con el formato que cifra', () => {
	/** Abre el diálogo con una entrada y confirma con lo dado, como el diálogo real. */
	async function comprimirCon(name: string, format: ArchiveFormat, password?: string) {
		const origen = archivo('datos.txt');
		const { openCompressDialog, handleCompressConfirm } = montar([origen]);
		openCompressDialog([origen]);
		await handleCompressConfirm(name, format, password);
		return pedidos('compress_items');
	}

	beforeEach(() => {
		responder('compress_items', { success: true, archive_path: '/casa/x' });
	});

	test('7z con clave la manda al backend, junto al resto de los datos', async () => {
		const [pedido, ...otros] = await comprimirCon('secreto', '7z', 'clave');

		expect(otros).toHaveLength(0);
		expect(pedido.argumentos).toMatchObject({
			sourcePaths: ['/casa/datos.txt'],
			destinationDir: '/casa',
			archiveName: 'secreto',
			format: '7z',
			password: 'clave',
		});
	});

	test('7z sin clave no manda ninguna', async () => {
		const [pedido] = await comprimirCon('abierto', '7z');

		expect(pedido.argumentos.format).toBe('7z');
		expect('password' in pedido.argumentos).toBe(false);
	});

	test('7z con clave vacía no manda ninguna', async () => {
		const [pedido] = await comprimirCon('abierto', '7z', '');

		expect('password' in pedido.argumentos).toBe(false);
	});

	test('los demás formatos no mandan clave aunque llegue una', async () => {
		for (const formato of [
			'zip',
			'tar.gz',
			'tar.xz',
			'tar.bz2',
			'tar',
			'tar.zst',
			'cpio',
		] as const) {
			olvidarTodo();
			responder('compress_items', { success: true });

			const [pedido] = await comprimirCon('x', formato, 'no-debe-viajar');

			expect(pedido.argumentos.format).toBe(formato);
			expect('password' in pedido.argumentos).toBe(false);
		}
	});

	test('tar.zst y cpio llegan tal cual como formato', async () => {
		const zst = await comprimirCon('a', 'tar.zst');
		olvidarTodo();
		responder('compress_items', { success: true });
		const cpio = await comprimirCon('b', 'cpio');

		expect(zst[0].argumentos.format).toBe('tar.zst');
		expect(cpio[0].argumentos.format).toBe('cpio');
	});

	test('el pedido lleva el id de la operación para poder cancelarla', async () => {
		const [pedido] = await comprimirCon('x', '7z', 'clave');

		expect(String(pedido.argumentos.operationId)).toStartWith('compress-');
	});

	test('si sale bien avisa que se creó el archivo; si no, el error', async () => {
		await comprimirCon('x', '7z', 'clave');
		responder('compress_items', { success: false, error: '7z exited with status 2' });
		await comprimirCon('y', '7z', 'clave');

		expect(avisos()).toEqual([
			{ kind: 'success', title: 'notifications.archiveCreated', description: '' },
			{
				kind: 'error',
				title: 'notifications.archiveCreateFailed',
				description: '7z exited with status 2',
			},
		]);
	});

	test('la clave no queda en el estado del diálogo de compresión', async () => {
		const origen = archivo('datos.txt');
		const seleccion = montar([origen]);
		seleccion.openCompressDialog([origen]);

		await seleccion.handleCompressConfirm('secreto', '7z', 'clave-que-no-debe-quedar');

		expect(JSON.stringify(seleccion.compressDialogState.value)).not.toContain(
			'clave-que-no-debe-quedar'
		);
		expect(seleccion.compressDialogState.value.isOpen).toBe(false);
		expect(seleccion.compressDialogState.value.entries).toEqual([]);
	});
});

describe('extraer un archivo cifrado', () => {
	test('el primer intento va sin clave', async () => {
		responder('extract_archive', 'Extracted');
		const { ejecutar } = montar([]);

		await ejecutar('extract-here', comprimido());

		const [pedido] = pedidos('extract_archive');
		expect(pedido.argumentos).toEqual({ archivePath: '/casa/caja.7z', destDir: '/casa' });
		expect(avisos()).toEqual([
			{ kind: 'success', title: 'notifications.archiveExtracted', description: '' },
		]);
	});

	test('ENCRYPTED pide la clave en vez de avisar un error', async () => {
		responder('extract_archive', () => {
			throw 'ENCRYPTED';
		});
		const { ejecutar, archivePasswordState } = montar([]);

		await ejecutar('extract-here', comprimido());

		expect(archivePasswordState.value).toMatchObject({
			isOpen: true,
			mode: 'extract',
			destDir: '/casa',
			password: '',
		});
		expect(archivePasswordState.value.entry?.path).toBe('/casa/caja.7z');
		expect(avisos()).toEqual([]);
	});

	test('reconoce el centinela aunque venga dentro de un Error o con texto alrededor', async () => {
		for (const falla of [
			() => {
				throw new Error('ENCRYPTED');
			},
			() => {
				throw 'extract failed: ENCRYPTED';
			},
		]) {
			olvidarTodo();
			responder('extract_archive', falla);
			const { ejecutar, archivePasswordState } = montar([]);

			await ejecutar('extract-here', comprimido());

			expect(archivePasswordState.value.isOpen).toBe(true);
			expect(avisos()).toEqual([]);
		}
	});

	test('con la clave reintenta el mismo archivo, la manda y cierra el diálogo', async () => {
		let intentos = 0;
		responder('extract_archive', (argumentos) => {
			intentos++;
			if (!argumentos.password) throw 'ENCRYPTED';
			return 'Extracted';
		});
		const { ejecutar, handleArchivePasswordConfirm, archivePasswordState } = montar([]);
		await ejecutar('extract-here', comprimido());

		await handleArchivePasswordConfirm('clave');

		expect(intentos).toBe(2);
		const [, reintento] = pedidos('extract_archive');
		expect(reintento.argumentos).toEqual({
			archivePath: '/casa/caja.7z',
			destDir: '/casa',
			password: 'clave',
		});
		expect(archivePasswordState.value.isOpen).toBe(false);
		expect(avisos()).toEqual([
			{ kind: 'success', title: 'notifications.archiveExtracted', description: '' },
		]);
	});

	test('la clave no queda en el estado mientras corre el backend ni después', async () => {
		let estadoDuranteElPedido = '';
		const seleccion = montar([]);
		responder('extract_archive', (argumentos) => {
			if (!argumentos.password) throw 'ENCRYPTED';
			estadoDuranteElPedido = JSON.stringify(seleccion.archivePasswordState.value);
			return 'Extracted';
		});
		await seleccion.ejecutar('extract-here', comprimido());
		// Lo que se tipeó en el diálogo queda en su estado hasta confirmar.
		seleccion.archivePasswordState.value.password = 'clave-secreta';

		await seleccion.handleArchivePasswordConfirm('clave-secreta');

		expect(estadoDuranteElPedido).not.toContain('clave-secreta');
		expect(seleccion.archivePasswordState.value).toEqual({
			isOpen: false,
			mode: 'extract',
			entry: null,
			destDir: '',
			password: '',
		});
	});

	test('WRONG_PASSWORD avisa y vuelve a pedir la clave', async () => {
		responder('extract_archive', (argumentos) => {
			throw argumentos.password ? 'WRONG_PASSWORD' : 'ENCRYPTED';
		});
		const { ejecutar, handleArchivePasswordConfirm, archivePasswordState } = montar([]);
		await ejecutar('extract-here', comprimido());
		// El primer ENCRYPTED sólo pide la clave: sin aviso de error.
		expect(avisos()).toEqual([]);

		await handleArchivePasswordConfirm('mala');

		expect(avisos()).toEqual([
			{ kind: 'error', title: 'notifications.archiveWrongPassword', description: '' },
		]);
		expect(archivePasswordState.value).toMatchObject({
			isOpen: true,
			mode: 'extract',
			password: '',
		});
		expect(archivePasswordState.value.entry?.path).toBe('/casa/caja.7z');
	});

	test('si la clave dada vuelve a fallar se puede insistir hasta acertar', async () => {
		responder('extract_archive', (argumentos) => {
			if (argumentos.password === 'buena') return 'Extracted';
			throw argumentos.password ? 'WRONG_PASSWORD' : 'ENCRYPTED';
		});
		const { ejecutar, handleArchivePasswordConfirm, archivePasswordState } = montar([]);
		await ejecutar('extract-here', comprimido());

		await handleArchivePasswordConfirm('mala');
		await handleArchivePasswordConfirm('buena');

		expect(pedidos('extract_archive').map((p) => p.argumentos.password)).toEqual([
			undefined,
			'mala',
			'buena',
		]);
		expect(archivePasswordState.value.isOpen).toBe(false);
		expect(avisos().map((aviso) => aviso.title)).toEqual([
			'notifications.archiveWrongPassword',
			'notifications.archiveExtracted',
		]);
	});

	test('una clave vacía en el diálogo no se manda: se vuelve a pedir', async () => {
		responder('extract_archive', () => {
			throw 'ENCRYPTED';
		});
		const { ejecutar, handleArchivePasswordConfirm, archivePasswordState } = montar([]);
		await ejecutar('extract-here', comprimido());

		await handleArchivePasswordConfirm('');

		expect('password' in pedidos('extract_archive')[1].argumentos).toBe(false);
		expect(archivePasswordState.value.isOpen).toBe(true);
	});

	test('cancelar el diálogo cierra todo sin reintentar', async () => {
		responder('extract_archive', () => {
			throw 'ENCRYPTED';
		});
		const { ejecutar, handleArchivePasswordCancel, archivePasswordState } = montar([]);
		await ejecutar('extract-here', comprimido());

		handleArchivePasswordCancel();
		await flushPromises();

		expect(pedidos('extract_archive')).toHaveLength(1);
		expect(archivePasswordState.value.isOpen).toBe(false);
		expect(archivePasswordState.value.entry).toBeNull();
		expect(avisos()).toEqual([]);
	});

	test('confirmar sin archivo pendiente no llama al backend', async () => {
		const { handleArchivePasswordConfirm } = montar([]);

		await handleArchivePasswordConfirm('clave');

		expect(pedidos('extract_archive')).toHaveLength(0);
		expect(pedidos('list_archive')).toHaveLength(0);
	});

	test('un error que no es de cifrado se avisa tal cual y no abre el diálogo', async () => {
		responder('extract_archive', () => {
			throw 'unzip failed: archivo dañado';
		});
		const { ejecutar, archivePasswordState } = montar([]);

		await ejecutar('extract-here', comprimido('caja.zip'));

		expect(archivePasswordState.value.isOpen).toBe(false);
		expect(avisos()).toEqual([
			{
				kind: 'error',
				title: 'notifications.archiveExtractFailed',
				description: 'unzip failed: archivo dañado',
			},
		]);
	});
});

describe('ver el contenido de un archivo comprimido', () => {
	test('lista sin clave y abre el diálogo con el nombre y las entradas', async () => {
		responder('list_archive', ['uno.txt', 'sub/dos.txt']);
		const { ejecutar, archiveContentState, archivePasswordState } = montar([]);

		await ejecutar('list-archive', comprimido('caja.zip'));

		const [pedido] = pedidos('list_archive');
		expect(pedido.argumentos).toEqual({ archivePath: '/casa/caja.zip' });
		expect(archiveContentState.value).toEqual({
			isOpen: true,
			name: 'caja.zip',
			items: ['uno.txt', 'sub/dos.txt'],
		});
		expect(archivePasswordState.value.isOpen).toBe(false);
		// Listar no extrae.
		expect(pedidos('extract_archive')).toHaveLength(0);
	});

	test('con más de una entrada elegida no hace nada', async () => {
		responder('list_archive', ['x']);
		const a = comprimido('a.zip');
		const { ejecutar, selectAll, archiveContentState } = montar([a, comprimido('b.zip')]);
		selectAll();

		await ejecutar('list-archive', a);

		expect(pedidos('list_archive')).toHaveLength(0);
		expect(archiveContentState.value.isOpen).toBe(false);
	});

	test('ENCRYPTED pide la clave y, con ella, vuelve a listar (no a extraer)', async () => {
		responder('list_archive', (argumentos) => {
			if (!argumentos.password) throw 'ENCRYPTED';
			return ['secreto.txt'];
		});
		const { ejecutar, handleArchivePasswordConfirm, archivePasswordState, archiveContentState } =
			montar([]);

		await ejecutar('list-archive', comprimido());
		expect(archivePasswordState.value).toMatchObject({ isOpen: true, mode: 'list' });
		expect(archiveContentState.value.isOpen).toBe(false);
		expect(avisos()).toEqual([]);

		await handleArchivePasswordConfirm('clave');

		const [, reintento] = pedidos('list_archive');
		expect(reintento.argumentos).toEqual({ archivePath: '/casa/caja.7z', password: 'clave' });
		expect(pedidos('extract_archive')).toHaveLength(0);
		expect(archivePasswordState.value.isOpen).toBe(false);
		expect(archiveContentState.value).toEqual({
			isOpen: true,
			name: 'caja.7z',
			items: ['secreto.txt'],
		});
	});

	test('WRONG_PASSWORD avisa y vuelve a pedir la clave, sin mostrar contenido', async () => {
		responder('list_archive', (argumentos) => {
			throw argumentos.password ? 'WRONG_PASSWORD' : 'ENCRYPTED';
		});
		const { ejecutar, handleArchivePasswordConfirm, archivePasswordState, archiveContentState } =
			montar([]);
		await ejecutar('list-archive', comprimido());

		await handleArchivePasswordConfirm('mala');

		expect(avisos()).toEqual([
			{ kind: 'error', title: 'notifications.archiveWrongPassword', description: '' },
		]);
		expect(archivePasswordState.value).toMatchObject({ isOpen: true, mode: 'list', password: '' });
		expect(archiveContentState.value.isOpen).toBe(false);
	});

	test('un error que no es de cifrado avisa que no se pudo listar', async () => {
		responder('list_archive', () => {
			throw 'Unsupported archive format for listing: .gz';
		});
		const { ejecutar, archivePasswordState, archiveContentState } = montar([]);

		await ejecutar('list-archive', comprimido('datos.gz'));

		expect(avisos()).toEqual([
			{
				kind: 'error',
				title: 'notifications.archiveListFailed',
				description: 'Unsupported archive format for listing: .gz',
			},
		]);
		expect(archivePasswordState.value.isOpen).toBe(false);
		expect(archiveContentState.value.isOpen).toBe(false);
	});

	test('un archivo vacío abre el diálogo con la lista vacía', async () => {
		responder('list_archive', []);
		const { ejecutar, archiveContentState } = montar([]);

		await ejecutar('list-archive', comprimido('vacio.zip'));

		expect(archiveContentState.value).toEqual({ isOpen: true, name: 'vacio.zip', items: [] });
	});
});
