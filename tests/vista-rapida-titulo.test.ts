import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { useQuickViewStore } from '@/stores/runtime/quick-view';
import { invocaciones, pedidos, responder } from './dobles';

describe('título de la ventana de vista rápida', () => {
	beforeEach(() => {
		invocaciones.length = 0;
		setActivePinia(createPinia());
		responder('plugin:window|get_all_windows', ['quick-view']);
	});

	test('el título lleva el nombre de la aplicación y el del archivo', async () => {
		const abierto = await useQuickViewStore().openFileFromMainWindow('/home/u/foto.png');

		expect(abierto).toBe(true);
		const [pedido] = pedidos('plugin:window|set_title');
		expect(pedido.argumentos.label).toBe('quick-view');
		expect(pedido.argumentos.value).toBe('Vasak File Manager | Quick View - foto.png');
	});
});
