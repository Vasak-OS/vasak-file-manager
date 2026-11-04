/**
 * «Nuevo documento» (#154): crear un archivo copiando una plantilla de
 * `~/Templates`.
 *
 * La copia es del backend (`create_item`, probado en Rust). Acá se prueba el
 * cableado de la ventana: qué plantillas se ofrecen, qué se manda al backend y
 * cómo se ve el menú y el diálogo.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DropdownMenu } from '@vasakgroup/vue-libvasak';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, getActivePinia, type Pinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import NewItemDialogComponent from '@/components/dialogs/NewItemDialogComponent.vue';
import FileBrowserToolbarComponent from '@/components/filebrowser/FileBrowserToolbarComponent.vue';
import { useFileBrowserDialogs } from '@/composables/file-browser/use-file-browser-dialogs';
import { useFileBrowserSelection } from '@/composables/file-browser/use-file-browser-selection';
import { useTemplates } from '@/composables/file-browser/use-templates';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { olvidarTodo, pedidos, responder } from './dobles';
import { archivo, carpeta } from './support/dir-entry';

const DIR = '/casa/Plantillas';

function conCarpetaDePlantillas(dir: string) {
	useUserPathsStore().userPaths.templateDir = dir;
}

// `enableAutoUnmount` sólo se puede llamar una vez por proceso y otra prueba ya
// lo hace: se limpia el documento a mano para que un menú no pase al siguiente.
afterEach(() => {
	document.body.innerHTML = '';
});

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
});

describe('useTemplates', () => {
	test('sin carpeta de plantillas la lista queda vacía y no se lee nada', async () => {
		conCarpetaDePlantillas('');
		const { templates, loadTemplates } = useTemplates();
		templates.value = [{ name: 'vieja', path: '/x/vieja' }];

		await loadTemplates();

		expect(templates.value).toEqual([]);
		expect(pedidos('read_dir')).toHaveLength(0);
	});

	test('ofrece sólo archivos visibles, ordenados por nombre', async () => {
		conCarpetaDePlantillas(DIR);
		responder('read_dir', {
			entries: [
				archivo('Planilla.ods', { path: `${DIR}/Planilla.ods` }),
				carpeta('Subcarpeta', { path: `${DIR}/Subcarpeta` }),
				archivo('.oculto', { path: `${DIR}/.oculto`, is_hidden: true }),
				archivo('Carta.odt', { path: `${DIR}/Carta.odt` }),
			],
		});
		const { templates, loadTemplates } = useTemplates();

		await loadTemplates();

		expect(pedidos('read_dir')[0].argumentos).toEqual({ path: DIR });
		expect(templates.value).toEqual([
			{ name: 'Carta.odt', path: `${DIR}/Carta.odt` },
			{ name: 'Planilla.ods', path: `${DIR}/Planilla.ods` },
		]);
	});

	test('si la carpeta no se puede leer no hay plantillas y no explota', async () => {
		conCarpetaDePlantillas(DIR);
		responder('read_dir', () => {
			throw new Error('no existe');
		});
		const original = console.error;
		console.error = () => {};
		try {
			const { templates, loadTemplates } = useTemplates();
			templates.value = [{ name: 'vieja', path: '/x/vieja' }];

			await loadTemplates();

			expect(templates.value).toEqual([]);
		} finally {
			console.error = original;
		}
	});
});

describe('createNewItem manda la plantilla al backend', () => {
	function montarSeleccion() {
		return useFileBrowserSelection(
			ref([]),
			ref('/casa/destino'),
			() => {},
			() => {},
			() => {}
		);
	}

	test('con plantilla, el pedido lleva su ruta', async () => {
		responder('create_item', { success: true });
		const { createNewItem } = montarSeleccion();

		const ok = await createNewItem('Informe.odt', 'file', `${DIR}/Carta.odt`);

		expect(ok).toBe(true);
		expect(pedidos('create_item')[0].argumentos).toEqual({
			directoryPath: '/casa/destino',
			name: 'Informe.odt',
			isDirectory: false,
			templatePath: `${DIR}/Carta.odt`,
		});
	});

	test('sin plantilla manda null, como un archivo vacío de siempre', async () => {
		responder('create_item', { success: true });
		const { createNewItem } = montarSeleccion();

		await createNewItem('a.txt', 'file');

		expect(pedidos('create_item')[0].argumentos.templatePath).toBeNull();
	});
});

describe('el diálogo de nuevo elemento', () => {
	function montarDialogos() {
		const llamadas: unknown[][] = [];
		const dialogos = useFileBrowserDialogs({
			renameState: ref({ isActive: false, entry: null }),
			cancelRename: () => {},
			batchRenameState: ref({ isActive: false, entries: [] }),
			cancelBatchRename: () => {},
			confirmBatchRename: async () => true,
			confirmRename: async () => true,
			createNewItem: async (...args) => {
				llamadas.push(args);
				return true;
			},
		});
		return { ...dialogos, llamadas };
	}

	test('elegir una plantilla abre el diálogo con su nombre precargado', () => {
		const { openTemplateDialog, newItemDialogState } = montarDialogos();

		openTemplateDialog({ path: `${DIR}/Carta.odt`, name: 'Carta.odt' });

		expect(newItemDialogState.value).toEqual({
			isOpen: true,
			type: 'template',
			templatePath: `${DIR}/Carta.odt`,
			defaultName: 'Carta.odt',
		});
	});

	test('confirmar crea un archivo a partir de la plantilla y cierra', async () => {
		const { openTemplateDialog, handleNewItemConfirm, newItemDialogState, llamadas } =
			montarDialogos();
		openTemplateDialog({ path: `${DIR}/Carta.odt`, name: 'Carta.odt' });

		await handleNewItemConfirm('Informe.odt');

		expect(llamadas).toEqual([['Informe.odt', 'file', `${DIR}/Carta.odt`]]);
		expect(newItemDialogState.value.isOpen).toBe(false);
	});

	test('abrir uno común después de una plantilla se olvida de ella', async () => {
		const { openTemplateDialog, openNewItemDialog, handleNewItemConfirm, llamadas } =
			montarDialogos();
		openTemplateDialog({ path: `${DIR}/Carta.odt`, name: 'Carta.odt' });

		openNewItemDialog('directory');
		await handleNewItemConfirm('docs');

		expect(llamadas).toEqual([['docs', 'directory', undefined]]);
	});

	test('el campo abre con el nombre de la plantilla, y vacío si no hay', async () => {
		const vista = mount(NewItemDialogComponent, {
			attachTo: document.body,
			props: { type: 'template', defaultName: 'Carta.odt', open: false },
		});
		await vista.setProps({ open: true });
		await nextTick();
		await nextTick();

		const campo = document.querySelector<HTMLInputElement>('input');
		expect(campo?.value).toBe('Carta.odt');
		expect(document.body.textContent).toContain('fileBrowser.newDocument');
	});

	test('un archivo común abre con el campo vacío', async () => {
		const vista = mount(NewItemDialogComponent, {
			attachTo: document.body,
			props: { type: 'file', open: false },
		});
		await vista.setProps({ open: true });
		await nextTick();
		await nextTick();

		expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('');
		expect(document.body.textContent).toContain('dialogs.newItemDialog.newFile');
	});
});

describe('el menú «Crear nuevo» de la barra', () => {
	const props = {
		pathInput: '/casa',
		filterQuery: '',
		canGoBack: false,
		canGoForward: false,
		canGoUp: false,
		isLoading: false,
		isFilterOpen: false,
	};

	async function montar(plantillas: boolean) {
		conCarpetaDePlantillas(DIR);
		responder('read_dir', {
			entries: plantillas ? [archivo('Carta.odt', { path: `${DIR}/Carta.odt` })] : [],
		});
		const vista = mount(FileBrowserToolbarComponent, {
			attachTo: document.body,
			props,
			global: { plugins: [getActivePinia() as Pinia] },
		});
		await nextTick();
		return vista;
	}

	/** Abre el menú por el contrato del `DropdownMenu` (`update:open`), no por el clic. */
	async function abrirMenu(plantillas: boolean) {
		const vista = await montar(plantillas);
		// El de «Crear nuevo» es el último de la barra, después del de la barra de direcciones.
		const menu = vista.findAllComponents(DropdownMenu).at(-1);
		menu?.vm.$emit('update:open', true);
		await flushPromises();
		await nextTick();
		return vista;
	}

	const opciones = () =>
		Array.from(document.querySelectorAll('[role="menuitem"]')).map((o) => o.textContent?.trim());

	test('al abrirlo lee las plantillas y las ofrece bajo «Nuevo documento»', async () => {
		await abrirMenu(true);

		expect(pedidos('read_dir')[0].argumentos).toEqual({ path: DIR });
		expect(opciones()).toContain('Carta.odt');
		expect(document.body.textContent).toContain('fileBrowser.newDocument');
	});

	test('el clic en el botón «Crear nuevo» también relee las plantillas', async () => {
		await montar(true);

		document.querySelector<HTMLElement>('button[aria-label="fileBrowser.createNew"]')?.click();
		await flushPromises();
		await nextTick();

		expect(opciones()).toContain('Carta.odt');
	});

	test('elegir una plantilla emite createFromTemplate con ella', async () => {
		const vista = await abrirMenu(true);

		const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((o) =>
			o.textContent?.includes('Carta.odt')
		);
		item?.click();
		await nextTick();

		expect(vista.emitted('createFromTemplate')).toEqual([
			[{ name: 'Carta.odt', path: `${DIR}/Carta.odt` }],
		]);
	});

	test('sin plantillas la sección no aparece', async () => {
		await abrirMenu(false);

		expect(opciones().length).toBeGreaterThan(0);
		expect(document.body.textContent).not.toContain('fileBrowser.newDocument');
	});
});
