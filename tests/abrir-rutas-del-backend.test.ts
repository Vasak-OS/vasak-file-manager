/**
 * Instancia única y `org.freedesktop.FileManager1` (#140): el lado de la ventana.
 *
 * El backend resuelve lo que pidieron a carpetas y emite `open-paths` con las
 * rutas. Lo que tiene que pasar acá es que cada una entre como pestaña nueva
 * del espacio de trabajo, y que al cerrar la ventana el oyente se suelte. El
 * resolver de URIs y el ruteo están probados en Rust (`file_manager1.rs`).
 *
 * Se monta `App.vue` de verdad; sólo se reemplazan los hijos pesados y las
 * operaciones de los almacenes que no son lo que se mira.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import App from '@/App.vue';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useUserLayoutStore } from '@/stores/storage/user-layout';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import { emitir, olvidarTodo, pedidos, responder } from './dobles';

/** Deja correr las promesas pendientes. */
const vaciarPromesas = async () => {
	for (let i = 0; i < 8; i++) await new Promise((sigue) => setTimeout(sigue, 0));
};

/** Las rutas con las que se abrió una pestaña, en orden. */
let abiertas: Array<string | undefined>;

/** Abre la ventana con el espacio de trabajo ya restaurado y espía `openNewTabGroup`. */
async function abrirLaVentana(
	rutaDeArranque: string | null = null,
	{ fallaEn }: { fallaEn?: 'init' | 'startup_path' } = {}
): Promise<VueWrapper> {
	olvidarTodo();
	abiertas = [];
	responder('startup_path', () => {
		if (fallaEn === 'startup_path') throw new Error('sin backend');
		return rutaDeArranque;
	});

	setActivePinia(createPinia());
	useUserPathsStore().init = mock(async () => {});
	useUserLayoutStore().init = mock(async () => {});
	const espacios = useWorkspacesStore();
	espacios.init = mock(async () => {
		if (fallaEn === 'init') throw new Error('el espacio de trabajo no se pudo restaurar');
	});
	espacios.openNewTabGroup = mock(async (ruta?: string) => {
		abiertas.push(ruta);
	}) as typeof espacios.openNewTabGroup;
	useShortcutsStore().init = mock(() => {});
	useGlobalSearchStore().initOnLaunch = mock(async () => {}) as never;

	const ventana = mount(App, {
		global: {
			stubs: {
				WindowAppLayout: true,
				ToastContainer: true,
				TextContextMenu: true,
			},
		},
	});
	await vaciarPromesas();
	return ventana;
}

beforeEach(() => {
	olvidarTodo();
});

describe('open-paths del backend', () => {
	test('cada ruta que llega abre una pestaña nueva, una vez por ruta y en orden', async () => {
		const ventana = await abrirLaVentana();

		await emitir('open-paths', ['/home/pato/Descargas', '/home/pato/Documentos', '/tmp']);

		expect(abiertas).toEqual(['/home/pato/Descargas', '/home/pato/Documentos', '/tmp']);
		ventana.unmount();
	});

	test('un evento sin rutas no abre nada', async () => {
		const ventana = await abrirLaVentana();

		await emitir('open-paths', []);

		expect(abiertas).toEqual([]);
		ventana.unmount();
	});

	test('dos eventos seguidos suman sus pestañas: el segundo no pisa al primero', async () => {
		const ventana = await abrirLaVentana();

		await emitir('open-paths', ['/a']);
		await emitir('open-paths', ['/b']);

		expect(abiertas).toEqual(['/a', '/b']);
		ventana.unmount();
	});

	test('la ruta de arranque y las que llegan después abren cada una la suya', async () => {
		const ventana = await abrirLaVentana('/inicio');
		expect(pedidos('startup_path')).toHaveLength(1);

		await emitir('open-paths', ['/despues']);

		expect(abiertas).toEqual(['/inicio', '/despues']);
		ventana.unmount();
	});

	test('al cerrar la ventana el oyente se suelta: un evento tardío no abre nada', async () => {
		const ventana = await abrirLaVentana();
		await emitir('open-paths', ['/a-tiempo']);
		ventana.unmount();

		await emitir('open-paths', ['/tarde']);

		expect(abiertas).toEqual(['/a-tiempo']);
	});

	test('si el `init` del espacio de trabajo falla, el oyente igual se registra y abre', async () => {
		const ventana = await abrirLaVentana(null, { fallaEn: 'init' });

		await emitir('open-paths', ['/igual']);

		expect(abiertas).toEqual(['/igual']);
		ventana.unmount();
	});

	test('si `startup_path` rechaza, el oyente igual se registra y abre', async () => {
		const ventana = await abrirLaVentana(null, { fallaEn: 'startup_path' });

		await emitir('open-paths', ['/igual']);

		expect(abiertas).toEqual(['/igual']);
		ventana.unmount();
	});
});
