/**
 * Renombrado por lotes (#147): el cableado entre el menú, el composable de
 * selección y el backend.
 *
 * El diálogo `.vue` no se monta; lo que se prueba es lo que decide el `.ts`:
 * cuándo se ofrece el renombrado por lotes, qué se le pide al backend y qué
 * pasa con la pantalla según cómo conteste.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { useToast } from '@/components/ui/toast/toaster';
import { useContextMenuItems } from '@/composables/file-browser/use-context-menu-items';
import { useFileBrowserSelection } from '@/composables/file-browser/use-file-browser-selection';
import { useUserStatsStore } from '@/stores/storage/user-stats';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { DirEntry } from '@/types/dir-entry';
import type { Tab } from '@/types/workspaces';
import { olvidarTodo, pedidos, responder } from './dobles';
import { archivo, carpeta } from './support/dir-entry';

/** Instancia el composable con las entradas dadas y cuenta lo que avisa hacia afuera. */
function montar(entradas: DirEntry[]) {
	const avisos: DirEntry[][] = [];
	let refrescos = 0;
	const seleccion = useFileBrowserSelection(
		ref(entradas),
		ref('/casa'),
		(elegidas) => avisos.push([...elegidas]),
		() => {},
		() => {
			refrescos++;
		}
	);
	return { ...seleccion, avisos, refrescos: () => refrescos };
}

const avisosDeToast = () =>
	[...useToast().toasts.value.values()].map((aviso) => ({
		kind: aviso.kind,
		title: aviso.title,
		description: aviso.description,
	}));

const pares = [
	{ sourcePath: '/casa/a.txt', newName: 'uno.txt' },
	{ sourcePath: '/casa/b.txt', newName: 'dos.txt' },
];

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	useToast().toasts.value.clear();
});

describe('el menú ofrece el renombrado por lotes', () => {
	test('sólo con varias entradas seleccionadas', () => {
		const dosArchivos = ref([archivo('a.txt'), archivo('b.txt')]);
		const archivoYCarpeta = ref([archivo('a.txt'), carpeta('docs')]);

		expect(useContextMenuItems(dosArchivos).isActionVisible('batch-rename')).toBe(true);
		expect(useContextMenuItems(archivoYCarpeta).isActionVisible('batch-rename')).toBe(true);
		expect(useContextMenuItems(ref([archivo('a.txt')])).isActionVisible('batch-rename')).toBe(
			false
		);
		expect(useContextMenuItems(ref([])).isActionVisible('batch-rename')).toBe(false);
	});
});

describe('abrir y cancelar el diálogo del lote', () => {
	test('la acción del menú abre el lote con las entradas seleccionadas', () => {
		const a = archivo('a.txt');
		const b = archivo('b.txt');
		const { contextMenu, handleContextMenuAction, batchRenameState } = montar([a, b]);
		contextMenu.value.selectedEntries = [a, b];

		handleContextMenuAction('batch-rename');

		expect(batchRenameState.value.isActive).toBe(true);
		expect(batchRenameState.value.entries).toEqual([a, b]);
	});

	test('con una sola entrada la acción no abre nada', () => {
		const a = archivo('a.txt');
		const { contextMenu, handleContextMenuAction, batchRenameState } = montar([a]);
		contextMenu.value.selectedEntries = [a];

		handleContextMenuAction('batch-rename');

		expect(batchRenameState.value.isActive).toBe(false);
	});

	test('sin entradas no abre el lote', () => {
		const { startBatchRename, batchRenameState } = montar([]);

		startBatchRename([]);

		expect(batchRenameState.value).toEqual({ isActive: false, entries: [] });
	});

	test('guarda una copia de las entradas: cambiar la lista de afuera no la altera', () => {
		const a = archivo('a.txt');
		const { startBatchRename, batchRenameState } = montar([]);
		const lista = [a, archivo('b.txt')];

		startBatchRename(lista);
		lista.pop();

		expect(batchRenameState.value.entries).toHaveLength(2);
	});

	test('cancelar cierra el lote y lo vacía', () => {
		const { startBatchRename, cancelBatchRename, batchRenameState } = montar([]);
		startBatchRename([archivo('a.txt'), archivo('b.txt')]);

		cancelBatchRename();

		expect(batchRenameState.value).toEqual({ isActive: false, entries: [] });
	});
});

describe('aplicar el lote', () => {
	test('manda todos los renombrados al backend en un solo pedido', async () => {
		responder('rename_items', { success: true, copied_count: 2, failed_count: 0 });
		const { confirmBatchRename } = montar([]);

		const resultado = await confirmBatchRename(pares);

		expect(resultado).toBe(true);
		const pedidosHechos = pedidos('rename_items');
		expect(pedidosHechos).toHaveLength(1);
		expect(pedidosHechos[0].argumentos).toEqual({ renames: pares });
		// Un lote es una operación: no se renombra de a uno.
		expect(pedidos('rename_item')).toHaveLength(0);
	});

	test('al salir bien avisa con la cantidad de elementos renombrados', async () => {
		responder('rename_items', { success: true });
		const { confirmBatchRename } = montar([]);

		await confirmBatchRename(pares);

		const [aviso, ...otros] = avisosDeToast();
		expect(otros).toHaveLength(0);
		expect(aviso.kind).toBe('success');
		expect(aviso.title).toBe('notifications.renamedItems');
		expect(aviso.description).toContain('renamedCountOther');
	});

	test('con un solo renombrado avisa en singular', async () => {
		responder('rename_items', { success: true });
		const { confirmBatchRename } = montar([]);

		await confirmBatchRename([pares[0]]);

		expect(avisosDeToast()[0].description).toContain('renamedCountOne');
	});

	test('al salir bien actualiza las pestañas y los favoritos de cada ruta renombrada', async () => {
		responder('rename_items', { success: true });
		const espacios = useWorkspacesStore();
		const pestana = (name: string) =>
			({ id: name, name, path: `/casa/${name}`, type: 'file' }) as Tab;
		espacios.workspaces[0].tabGroups.push([pestana('a.txt'), pestana('b.txt')]);
		const estadisticas = useUserStatsStore();
		await estadisticas.addToFavorites('/casa/a.txt', true);
		await estadisticas.addToFavorites('/casa/b.txt', true);
		const { confirmBatchRename } = montar([]);

		await confirmBatchRename(pares);

		expect(espacios.workspaces[0].tabGroups[0].map((pestana) => pestana.path)).toEqual([
			'/casa/uno.txt',
			'/casa/dos.txt',
		]);
		expect(espacios.workspaces[0].tabGroups[0].map((pestana) => pestana.name)).toEqual([
			'uno.txt',
			'dos.txt',
		]);
		expect(estadisticas.favorites.map((favorito) => favorito.path)).toEqual([
			'/casa/uno.txt',
			'/casa/dos.txt',
		]);
	});

	test('invalida el tamaño de lo renombrado y el de la carpeta actual', async () => {
		responder('rename_items', { success: true });
		const { confirmBatchRename } = montar([]);

		await confirmBatchRename(pares);

		const [invalidacion] = pedidos('invalidate_dir_size_cache');
		expect(invalidacion.argumentos).toEqual({
			paths: ['/casa/a.txt', '/casa/b.txt', '/casa'],
		});
	});

	test('al salir bien cierra el diálogo, limpia la selección y refresca', async () => {
		responder('rename_items', { success: true });
		const a = archivo('a.txt');
		const b = archivo('b.txt');
		const { selectAll, startBatchRename, confirmBatchRename, batchRenameState, avisos, refrescos } =
			montar([a, b]);
		selectAll();
		startBatchRename([a, b]);

		await confirmBatchRename(pares);

		expect(batchRenameState.value).toEqual({ isActive: false, entries: [] });
		expect(avisos.at(-1)).toEqual([]);
		expect(refrescos()).toBe(1);
	});

	test('sin renombrados no llama al backend, cierra el diálogo y devuelve false', async () => {
		const { startBatchRename, confirmBatchRename, batchRenameState, refrescos } = montar([]);
		startBatchRename([archivo('a.txt'), archivo('b.txt')]);

		const resultado = await confirmBatchRename([]);

		expect(resultado).toBe(false);
		expect(pedidos('rename_items')).toHaveLength(0);
		expect(batchRenameState.value.isActive).toBe(false);
		expect(refrescos()).toBe(0);
	});

	test('si el backend dice que falló avisa el error y deja el diálogo abierto', async () => {
		responder('rename_items', { success: false, error: 'ya existe uno.txt' });
		const espacios = useWorkspacesStore();
		const { startBatchRename, confirmBatchRename, batchRenameState, refrescos } = montar([]);
		startBatchRename([archivo('a.txt'), archivo('b.txt')]);

		const resultado = await confirmBatchRename(pares);

		expect(resultado).toBe(false);
		expect(avisosDeToast()).toEqual([
			{
				kind: 'error',
				title: 'notifications.failedToRenameItems',
				description: 'ya existe uno.txt',
			},
		]);
		expect(batchRenameState.value.isActive).toBe(true);
		expect(refrescos()).toBe(0);
		expect(espacios.lastRenamedPath).toBeNull();
		expect(pedidos('invalidate_dir_size_cache')).toHaveLength(0);
	});

	test('un fallo sin mensaje avisa con la descripción vacía', async () => {
		responder('rename_items', { success: false });
		const { confirmBatchRename } = montar([]);

		await confirmBatchRename(pares);

		expect(avisosDeToast()[0].description).toBe('');
	});

	test('si el pedido al backend revienta avisa el error y no toca la pantalla', async () => {
		responder('rename_items', () => {
			throw new Error('sin conexión con el backend');
		});
		const { startBatchRename, confirmBatchRename, batchRenameState, refrescos } = montar([]);
		startBatchRename([archivo('a.txt'), archivo('b.txt')]);

		const resultado = await confirmBatchRename(pares);

		expect(resultado).toBe(false);
		const [aviso] = avisosDeToast();
		expect(aviso.kind).toBe('error');
		expect(aviso.title).toBe('notifications.failedToRenameItems');
		expect(aviso.description).toContain('sin conexión con el backend');
		expect(batchRenameState.value.isActive).toBe(true);
		expect(refrescos()).toBe(0);
	});
});
