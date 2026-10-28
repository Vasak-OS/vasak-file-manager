/**
 * Rehacer lo deshecho (#145).
 *
 * El backend guarda la pila; acá se prueba lo que ve quien usa la ventana: el
 * composable pregunta antes de actuar, refresca la lista, avisa con el texto
 * que corresponde, y Ctrl+Y está cableado al atajo `redo`.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { toast, useToast } from '@/components/ui/toast/toaster';
import { useFileBrowserSelection } from '@/composables/file-browser/use-file-browser-selection';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { olvidarTodo, pedidos, responder } from './dobles';

function montar() {
	const refrescos = { cantidad: 0 };
	const seleccion = useFileBrowserSelection(
		ref([]),
		ref('/casa'),
		() => {},
		() => {},
		() => {
			refrescos.cantidad++;
		}
	);
	return { ...seleccion, refrescos };
}

const avisos = () => [...useToast().toasts.value.values()].map((a) => [a.kind, a.title]);

const resultado = (campos: Record<string, unknown> = {}) => ({
	success: true,
	error: null,
	kind: 'move',
	undone_count: 1,
	failed_count: 0,
	affected_paths: ['/casa/a', '/casa/b'],
	...campos,
});

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	toast.dismissAll();
});

describe('rehacer la última operación', () => {
	test('sin nada que rehacer avisa y no toca el disco ni la lista', async () => {
		responder('get_redo_info', null);
		const { redoLastOperation, refrescos } = montar();

		await redoLastOperation();

		expect(avisos()).toEqual([['success', 'notifications.nothingToRedo']]);
		expect(pedidos('redo_last_operation')).toHaveLength(0);
		expect(refrescos.cantidad).toBe(0);
	});

	test('rehace con el comando de rehacer, nunca con el de deshacer', async () => {
		responder('get_redo_info', { id: 'undo-1', kind: 'move', item_count: 1, partial: false });
		responder('redo_last_operation', resultado());
		const { redoLastOperation } = montar();

		await redoLastOperation();

		expect(pedidos('redo_last_operation')).toHaveLength(1);
		expect(pedidos('undo_last_operation')).toHaveLength(0);
		expect(pedidos('get_undo_info')).toHaveLength(0);
	});

	test('al salir bien refresca la lista y avisa «rehecha»', async () => {
		responder('get_redo_info', { id: 'undo-1', kind: 'move', item_count: 1, partial: false });
		responder('redo_last_operation', resultado());
		const { redoLastOperation, refrescos } = montar();

		await redoLastOperation();

		expect(refrescos.cantidad).toBe(1);
		expect(avisos()).toEqual([['success', 'notifications.redone']]);
	});

	test('si falla avisa el error con su detalle', async () => {
		responder('get_redo_info', { id: 'undo-1', kind: 'move', item_count: 1, partial: false });
		responder(
			'redo_last_operation',
			resultado({ success: false, error: 'sin permiso', undone_count: 0, failed_count: 1 })
		);
		const { redoLastOperation, refrescos } = montar();

		await redoLastOperation();

		expect(refrescos.cantidad).toBe(1);
		const [aviso] = [...useToast().toasts.value.values()];
		expect([aviso.kind, aviso.title, aviso.description]).toEqual([
			'error',
			'notifications.redoFailed',
			'sin permiso',
		]);
	});
});

describe('el atajo de rehacer', () => {
	test('Ctrl+Y dispara el atajo `redo` una vez y no el de deshacer', async () => {
		const tienda = useShortcutsStore();
		expect(tienda.getShortcutDefinition('redo')?.defaultKeys).toEqual({ ctrl: true, key: 'y' });

		const disparos: string[] = [];
		tienda.registerHandler('redo', () => {
			disparos.push('redo');
		});
		tienda.registerHandler('undo', () => {
			disparos.push('undo');
		});

		await tienda.handleKeydown(
			new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, cancelable: true })
		);

		expect(disparos).toEqual(['redo']);
	});
});
