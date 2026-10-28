/**
 * Enlazar elementos (#148): lo que `linkItems` le pide al backend y lo que hace
 * con la pantalla según cómo conteste.
 *
 * Crear los enlaces es del backend (`link_items`, probado en Rust). Lo que se
 * prueba acá es el cableado de la ventana: un solo pedido con todos los
 * orígenes, la resolución que se manda, el aviso, y que sólo si salió bien se
 * limpie la selección y se refresque la lista.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { useToast } from '@/components/ui/toast/toaster';
import { useFileBrowserSelection } from '@/composables/file-browser/use-file-browser-selection';
import type { DirEntry } from '@/types/dir-entry';
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

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	useToast().toasts.value.clear();
});

describe('linkItems pide los enlaces al backend', () => {
	test('manda todos los orígenes en un solo pedido, con el destino y sin pisar nada', async () => {
		responder('link_items', { success: true, copied_count: 2, failed_count: 0 });
		const { linkItems } = montar([]);

		const resultado = await linkItems([archivo('a.txt'), carpeta('docs')], '/casa/destino');

		expect(resultado).toBe(true);
		const hechos = pedidos('link_items');
		// Una sola operación, no un pedido por entrada.
		expect(hechos).toHaveLength(1);
		expect(hechos[0].argumentos).toEqual({
			sourcePaths: ['/casa/a.txt', '/casa/docs'],
			destinationPath: '/casa/destino',
			// Un enlace nunca pisa lo que hay: si el nombre está ocupado, se le busca otro.
			conflictResolution: 'auto-rename',
		});
	});

	test('no pasa por el portapapeles ni por copiar o mover', async () => {
		responder('link_items', { success: true, copied_count: 1 });
		const { linkItems } = montar([]);

		await linkItems([archivo('a.txt')], '/casa/destino');

		expect(pedidos('copy_items')).toHaveLength(0);
		expect(pedidos('move_items')).toHaveLength(0);
	});

	test('sin entradas no llama al backend y devuelve false', async () => {
		const { linkItems, refrescos } = montar([]);

		const resultado = await linkItems([], '/casa/destino');

		expect(resultado).toBe(false);
		expect(pedidos('link_items')).toHaveLength(0);
		expect(avisosDeToast()).toEqual([]);
		expect(refrescos()).toBe(0);
	});
});

describe('linkItems cuando sale bien', () => {
	test('avisa con la cantidad de enlaces que creó el backend, en plural', async () => {
		responder('link_items', { success: true, copied_count: 2 });
		const { linkItems } = montar([]);

		await linkItems([archivo('a.txt'), archivo('b.txt')], '/casa/destino');

		const [aviso, ...otros] = avisosDeToast();
		expect(otros).toHaveLength(0);
		expect(aviso.kind).toBe('success');
		expect(aviso.title).toBe('notifications.linkedItems');
		expect(aviso.description).toContain('linkedCountOther');
	});

	test('cuenta lo que creó el backend, no lo que se le pidió', async () => {
		responder('link_items', { success: true, copied_count: 1 });
		const { linkItems } = montar([]);

		await linkItems([archivo('a.txt'), archivo('b.txt')], '/casa/destino');

		expect(avisosDeToast()[0].description).toContain('linkedCountOne');
	});

	test('si el backend no informa la cuenta, usa la cantidad de entradas', async () => {
		responder('link_items', { success: true });
		const { linkItems } = montar([]);

		await linkItems([archivo('a.txt')], '/casa/destino');
		await linkItems([archivo('a.txt'), archivo('b.txt')], '/casa/destino');

		const descripciones = avisosDeToast().map((aviso) => aviso.description);
		expect(descripciones[0]).toContain('linkedCountOne');
		expect(descripciones[1]).toContain('linkedCountOther');
	});

	test('invalida el tamaño del destino y el de la carpeta actual', async () => {
		responder('link_items', { success: true, copied_count: 1 });
		const { linkItems } = montar([]);

		await linkItems([archivo('a.txt')], '/casa/destino');

		const [invalidacion] = pedidos('invalidate_dir_size_cache');
		expect(invalidacion.argumentos).toEqual({ paths: ['/casa/destino', '/casa'] });
	});

	test('limpia la selección y refresca la lista', async () => {
		responder('link_items', { success: true, copied_count: 2 });
		const a = archivo('a.txt');
		const b = archivo('b.txt');
		const { selectAll, linkItems, selectedEntries, avisos, refrescos } = montar([a, b]);
		selectAll();
		expect(selectedEntries.value).toHaveLength(2);

		const resultado = await linkItems([a, b], '/casa/destino');

		expect(resultado).toBe(true);
		expect(selectedEntries.value).toEqual([]);
		expect(avisos.at(-1)).toEqual([]);
		expect(refrescos()).toBe(1);
	});
});

describe('linkItems cuando sale mal', () => {
	test('si el backend dice que falló avisa el error y no toca la pantalla', async () => {
		responder('link_items', { success: false, error: 'Permission denied' });
		const a = archivo('a.txt');
		const { selectAll, linkItems, selectedEntries, refrescos } = montar([a]);
		selectAll();

		const resultado = await linkItems([a], '/casa/destino');

		expect(resultado).toBe(false);
		expect(avisosDeToast()).toEqual([
			{
				kind: 'error',
				title: 'notifications.failedToLinkItems',
				description: 'Permission denied',
			},
		]);
		// La selección sigue y no se refresca: no hubo cambios que mostrar.
		expect(selectedEntries.value).toEqual([a]);
		expect(refrescos()).toBe(0);
		expect(pedidos('invalidate_dir_size_cache')).toHaveLength(0);
	});

	test('un fallo sin mensaje avisa con la descripción vacía', async () => {
		responder('link_items', { success: false });
		const { linkItems } = montar([]);

		await linkItems([archivo('a.txt')], '/casa/destino');

		expect(avisosDeToast()[0].description).toBe('');
	});

	test('si el pedido al backend revienta avisa el error y devuelve false', async () => {
		responder('link_items', () => {
			throw new Error('sin conexión con el backend');
		});
		const { linkItems, refrescos } = montar([]);

		const resultado = await linkItems([archivo('a.txt')], '/casa/destino');

		expect(resultado).toBe(false);
		const [aviso] = avisosDeToast();
		expect(aviso.kind).toBe('error');
		expect(aviso.title).toBe('notifications.failedToLinkItems');
		expect(aviso.description).toContain('sin conexión con el backend');
		expect(refrescos()).toBe(0);
	});
});
