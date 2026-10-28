/**
 * La papelera navegable (#141).
 *
 * Es una vista overlay, como la búsqueda global, y no una pestaña: lo que hay
 * en la papelera no está en su ruta original, así que no pasa por el navegador
 * de carpetas. Acá se prueba cada punta del cableado por separado, porque son
 * los lugares donde se puede cortar sin ningún error: el store que pide la
 * lista, la vista que la dibuja y restaura, el botón del sidebar que la abre y
 * la barra del navegador que la muestra, la cierra con Escape y no la deja
 * convivir con la búsqueda.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { SideButton } from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import SidebarComponent from '@/components/sidebar/SidebarComponent.vue';
import { toast, useToast } from '@/components/ui/toast/toaster';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useTrashStore } from '@/stores/runtime/trash';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { TrashEntry } from '@/types/trash';
import TrashView from '@/views/TrashView.vue';
import { olvidarTodo, pedidos, responder } from './dobles';

/** Una entrada de la papelera; cada prueba cambia sólo lo suyo. */
function unaEntrada(cambios: Partial<TrashEntry> = {}): TrashEntry {
	return {
		name: 'informe.pdf',
		original_path: '/home/pato/Documentos/informe.pdf',
		deleted_time: 1_760_000_000,
		...cambios,
	};
}

const viejo = unaEntrada();
const nuevo = unaEntrada({
	name: 'foto.png',
	original_path: '/home/pato/Imágenes/foto.png',
	deleted_time: 1_760_100_000,
});

/** Deja que terminen las promesas encadenadas de un clic o de un montaje. */
async function asentar(vueltas = 8) {
	for (let i = 0; i < vueltas; i++) {
		await nextTick();
		await new Promise((sigue) => setTimeout(sigue, 0));
	}
}

const montadas: VueWrapper[] = [];

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	toast.dismissAll();
	// Lo que piden al montarse la barra del navegador y la búsqueda global.
	responder('get_index_status', {});
	responder('get_active_calculations', []);
	responder('get_system_drives', []);
	responder('list_cloud_drives', []);
});

afterEach(() => {
	while (montadas.length) montadas.pop()?.unmount();
	// El Dialog se teletransporta al body: lo que quede ensucia a la siguiente.
	document.body.innerHTML = '';
});

function titulosDeAvisos() {
	return [...useToast().toasts.value.values()].map((aviso) => `${aviso.kind}:${aviso.title}`);
}

describe('el store de la papelera', () => {
	test('abrirla la muestra y carga la lista del backend', async () => {
		responder('list_trash', [nuevo, viejo]);
		const store = useTrashStore();
		expect(store.isOpen).toBe(false);

		await store.open();

		expect(store.isOpen).toBe(true);
		expect(store.items).toEqual([nuevo, viejo]);
		expect(pedidos('list_trash')).toHaveLength(1);
	});

	test('si el backend falla, queda abierta y vacía en vez de romper', async () => {
		responder('list_trash', () => {
			throw new Error('sin acceso a la papelera');
		});
		const store = useTrashStore();
		store.items = [viejo];
		// El error se escribe en la consola a propósito; se calla para no
		// ensuciar la salida de la suite.
		const consola = spyOn(console, 'error').mockImplementation(() => {});

		await store.open();

		consola.mockRestore();
		expect(store.isOpen).toBe(true);
		expect(store.items).toEqual([]);
		expect(store.isLoading).toBe(false);
	});

	test('cerrarla baja el estado y conserva la lista', async () => {
		responder('list_trash', [viejo]);
		const store = useTrashStore();
		await store.open();

		store.close();

		expect(store.isOpen).toBe(false);
		expect(store.items).toEqual([viejo]);
	});

	test('restaurar pide las rutas al backend, recarga la lista y devuelve cuántas volvieron', async () => {
		let restaurado = false;
		responder('list_trash', () => (restaurado ? [nuevo] : [nuevo, viejo]));
		responder('restore_trash', () => {
			restaurado = true;
			return 1;
		});
		const store = useTrashStore();
		await store.open();
		expect(store.items).toHaveLength(2);

		const volvieron = await store.restore([viejo.original_path]);

		expect(volvieron).toBe(1);
		expect(pedidos('restore_trash').map((p) => p.argumentos)).toEqual([
			{ paths: [viejo.original_path] },
		]);
		// La recarga: sin ella la fila restaurada seguiría en pantalla.
		expect(pedidos('list_trash')).toHaveLength(2);
		expect(store.items).toEqual([nuevo]);
	});

	test('vaciarla pide el vaciado al backend y recarga a vacío', async () => {
		let vaciada = false;
		responder('list_trash', () => (vaciada ? [] : [nuevo, viejo]));
		responder('empty_trash', () => {
			vaciada = true;
			return 2;
		});
		const store = useTrashStore();
		await store.open();

		const borrados = await store.empty();

		expect(borrados).toBe(2);
		expect(pedidos('empty_trash')).toHaveLength(1);
		expect(pedidos('list_trash')).toHaveLength(2);
		expect(store.items).toEqual([]);
	});

	test('si restaurar falla, el error le llega a quien lo pidió y no recarga', async () => {
		responder('list_trash', [viejo]);
		responder('restore_trash', () => {
			throw new Error('ya existe');
		});
		const store = useTrashStore();
		await store.open();

		await expect(store.restore([viejo.original_path])).rejects.toThrow('ya existe');

		expect(pedidos('list_trash')).toHaveLength(1);
	});
});

describe('la vista de la papelera', () => {
	async function abrirLaVista(entradas: TrashEntry[]) {
		responder('list_trash', entradas);
		const store = useTrashStore();
		await store.load();
		const vista = mount(TrashView);
		montadas.push(vista);
		await asentar(2);
		return { vista, store };
	}

	/** El botón con ese texto, buscado en toda la página (el diálogo va al body). */
	function botonCon(texto: string) {
		return [...document.querySelectorAll('button')].find(
			(boton) => boton.textContent?.includes(texto) || boton.getAttribute('aria-label') === texto
		);
	}

	test('lista cada elemento con su nombre, su ruta original y su fecha', async () => {
		const { vista } = await abrirLaVista([nuevo, viejo]);
		const texto = vista.text();

		expect(texto).toContain('foto.png');
		expect(texto).toContain('/home/pato/Imágenes/foto.png');
		expect(texto).toContain('informe.pdf');
		expect(texto).toContain('/home/pato/Documentos/informe.pdf');
		// La fecha sale de los segundos unix: 1_760_000_000 es de 2025.
		expect(texto).toContain('2025');
		expect(vista.findAll('li')).toHaveLength(2);
	});

	test('sin elementos muestra el estado vacío y no deja vaciar', async () => {
		const { vista } = await abrirLaVista([]);

		expect(vista.text()).toContain('trash.emptyTitle');
		expect(vista.text()).toContain('trash.emptyNote');
		expect(vista.findAll('li')).toHaveLength(0);
		const vaciar = vista.findAll('button').find((b) => b.text().includes('trash.empty'));
		expect(vaciar?.attributes('disabled')).toBeDefined();
	});

	test('con elementos, no muestra el estado vacío y deja vaciar', async () => {
		const { vista } = await abrirLaVista([viejo]);

		expect(vista.text()).not.toContain('trash.emptyTitle');
		const vaciar = vista.findAll('button').find((b) => b.text().includes('trash.empty'));
		expect(vaciar?.attributes('disabled')).toBeUndefined();
	});

	test('la cruz avisa que se cierre', async () => {
		const { vista } = await abrirLaVista([viejo]);

		await vista.find('button[title="trash.close"]').trigger('click');

		expect(vista.emitted('close')).toHaveLength(1);
	});

	test('restaurar una fila pide su ruta original y avisa que volvió', async () => {
		responder('restore_trash', () => 1);
		const { vista } = await abrirLaVista([nuevo, viejo]);
		const fila = vista.findAll('li').find((li) => li.text().includes('informe.pdf'));

		await fila
			?.findAll('button')
			.find((b) => b.text().includes('trash.restore'))
			?.trigger('click');
		await asentar();

		expect(pedidos('restore_trash').map((p) => p.argumentos)).toEqual([
			{ paths: [viejo.original_path] },
		]);
		expect(titulosDeAvisos()).toEqual(['success:notifications.restored']);
	});

	test('si restaurar falla, avisa con un cartel de error', async () => {
		responder('restore_trash', () => {
			throw new Error('ya existe');
		});
		const { vista } = await abrirLaVista([viejo]);

		await vista
			.findAll('button')
			.find((b) => b.text().includes('trash.restore'))
			?.trigger('click');
		await asentar();

		expect(titulosDeAvisos()).toEqual(['error:notifications.restoreFailed']);
	});

	test('vaciar pide confirmación y no borra hasta que se confirma', async () => {
		responder('empty_trash', () => 1);
		const { vista } = await abrirLaVista([viejo]);

		await vista
			.findAll('button')
			.find((b) => b.text().includes('trash.empty'))
			?.trigger('click');
		await asentar();

		expect(document.body.textContent).toContain('trash.emptyConfirmTitle');
		expect(pedidos('empty_trash')).toHaveLength(0);
	});

	test('confirmar el vaciado lo pide al backend y avisa', async () => {
		responder('empty_trash', () => 1);
		const { vista } = await abrirLaVista([viejo]);
		await vista
			.findAll('button')
			.find((b) => b.text().includes('trash.empty'))
			?.trigger('click');
		await asentar();

		// Dentro del diálogo hay dos botones «trash.empty»: el de la cabecera
		// y el de confirmar; el de confirmar es el último en el documento.
		const confirmar = [...document.querySelectorAll('button')]
			.filter((b) => b.textContent?.includes('trash.empty'))
			.at(-1);
		confirmar?.click();
		await asentar();

		expect(pedidos('empty_trash')).toHaveLength(1);
		expect(titulosDeAvisos()).toEqual(['success:notifications.trashEmptied']);
	});

	test('si el vaciado falla, avisa con un cartel de error y deja el diálogo abierto', async () => {
		responder('empty_trash', () => {
			throw new Error('sin permiso');
		});
		const { vista } = await abrirLaVista([viejo]);
		await vista
			.findAll('button')
			.find((b) => b.text().includes('trash.empty'))
			?.trigger('click');
		await asentar();

		[...document.querySelectorAll('button')]
			.filter((b) => b.textContent?.includes('trash.empty'))
			.at(-1)
			?.click();
		await asentar();

		expect(titulosDeAvisos()).toEqual(['error:notifications.emptyTrashFailed']);
		expect(botonCon('trash.cancel')).toBeDefined();
	});
});

describe('el sidebar', () => {
	async function abrirLaBarra() {
		const pinia = createPinia();
		setActivePinia(pinia);
		const trash = useTrashStore();
		const workspaces = useWorkspacesStore();
		const vista = mount(SidebarComponent, { global: { plugins: [pinia] } });
		montadas.push(vista);
		await asentar();
		return { vista, trash, workspaces };
	}

	const botonPapelera = (vista: VueWrapper) =>
		vista.findAllComponents(SideButton).find((b) => b.props('label') === 'barraLateral.papelera');

	test('tiene el botón Papelera con el ícono de la papelera', async () => {
		const { vista } = await abrirLaBarra();

		expect(botonPapelera(vista)?.props('icon')).toBe('user-trash');
	});

	test('apretarlo abre la vista de la papelera y no navega a ninguna carpeta', async () => {
		responder('list_trash', [viejo]);
		const { vista, trash, workspaces } = await abrirLaBarra();
		const abrir = spyOn(workspaces, 'openNewTabGroup');
		const antes = workspaces.currentTab?.path;

		await botonPapelera(vista)?.trigger('click');
		await asentar();

		expect(trash.isOpen).toBe(true);
		expect(trash.items).toEqual([viejo]);
		expect(abrir).not.toHaveBeenCalled();
		expect(workspaces.currentTab?.path).toBe(antes);
	});
});

describe('la barra del navegador', () => {
	function barraDelNavegador() {
		const vista = mount(NavigatorBarComponent, {
			global: {
				stubs: {
					FileBrowserComponent: true,
					GlobalSearchView: true,
					ClipboardToolbarComponent: true,
				},
			},
		});
		montadas.push(vista);
		return vista;
	}

	const apretarEscape = async () =>
		await useShortcutsStore().handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

	test('monta la vista de la papelera y la muestra sólo mientras está abierta', async () => {
		responder('list_trash', []);
		const vista = barraDelNavegador();
		const papelera = vista.findComponent(TrashView);
		expect(papelera.exists()).toBe(true);
		expect(papelera.element.style.display).toBe('none');

		await useTrashStore().open();
		await asentar(2);
		expect(papelera.element.style.display).not.toBe('none');

		useTrashStore().close();
		await asentar(2);
		expect(papelera.element.style.display).toBe('none');
	});

	test('la cruz de la vista la cierra', async () => {
		responder('list_trash', []);
		const vista = barraDelNavegador();
		await useTrashStore().open();

		vista.findComponent(TrashView).vm.$emit('close');
		await asentar(2);

		expect(useTrashStore().isOpen).toBe(false);
	});

	test('Escape la cierra', async () => {
		responder('list_trash', []);
		barraDelNavegador();
		const trash = useTrashStore();
		await trash.open();

		expect(await apretarEscape()).toBe(true);

		expect(trash.isOpen).toBe(false);
	});

	test('abrir la papelera cierra la búsqueda global', async () => {
		responder('list_trash', []);
		barraDelNavegador();
		const busqueda = useGlobalSearchStore();
		await busqueda.open();
		expect(busqueda.isOpen).toBe(true);

		await useTrashStore().open();
		await asentar(2);

		expect(useTrashStore().isOpen).toBe(true);
		expect(busqueda.isOpen).toBe(false);
	});

	test('abrir la búsqueda global cierra la papelera', async () => {
		responder('list_trash', []);
		barraDelNavegador();
		const trash = useTrashStore();
		await trash.open();
		expect(trash.isOpen).toBe(true);

		await useGlobalSearchStore().open();
		await asentar(2);

		expect(useGlobalSearchStore().isOpen).toBe(true);
		expect(trash.isOpen).toBe(false);
	});
});
