/**
 * Qué muestra el contenido del navegador según el estado, ahora que la cadena
 * Cargando / Error / Vacío / Contenido va envuelta en `RevealTransition`.
 *
 * Cambió el envoltorio, no lo que se ve: una sola rama a la vez. Lo que sí
 * puede romperse al envolver es la propia transición, que exige **un solo
 * hijo elemento**: un comentario o un fragmento dentro de la rama de contenido
 * hace que Vue avise («Component inside <Transition> renders non-element root
 * node») y deje de animar sin fallar nada más. Por eso se monta con la
 * transición de verdad —no la que sustituye `@vue/test-utils`— y se escuchan
 * los avisos.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, defineComponent, h, nextTick, onMounted, ref } from 'vue';
import FileBrowserContentComponent from '@/components/filebrowser/FileBrowserContentComponent.vue';
import {
	FILE_BROWSER_CONTEXT_KEY,
	type FileBrowserContext,
} from '@/composables/file-browser/use-file-browser-context';
import { olvidarTodo } from './dobles';

const isLoading = ref(false);
const error = ref<string | null>(null);
const vacio = ref(false);
const ruta = ref('/casa');

function contexto(): FileBrowserContext {
	return {
		entries: computed(() => []),
		currentPath: computed(() => ruta.value),
		isLoading,
		isDirectoryEmpty: computed(() => vacio.value),
		error,
		listSortColumn: ref(null),
		listSortDirection: ref('asc'),
		selectedEntries: ref([]),
		isEntrySelected: () => false,
		contextMenu: ref({
			visible: false,
			x: 0,
			y: 0,
			entry: null,
		}) as FileBrowserContext['contextMenu'],
		getVideoThumbnail: () => undefined,
		setEntriesContainerRef: () => {},
		iconScale: ref(1),
		zoomIn: () => {},
		zoomOut: () => {},
		zoomReset: () => {},
		registrarSeccionesVisuales: () => {},
		registrarDesplazamiento: () => {},
		onEntryMouseDown: () => {},
		onEntryMouseUp: () => {},
		openEntryContextMenu: () => {},
		onContextMenuAction: () => {},
		openOpenWithDialog: () => {},
		navigateToHome: () => {},
	} as FileBrowserContext;
}

let vista: VueWrapper | null = null;
let montajesDeLaCuadricula = 0;

/** La cuadrícula de mentira: cuenta cuántas veces se monta. */
const Cuadricula = defineComponent({
	setup() {
		onMounted(() => {
			montajesDeLaCuadricula++;
		});
		return () => h('div', { 'data-rama': 'cuadricula' });
	},
});

let avisos: ReturnType<typeof spyOn>;

function montar() {
	vista = mount(FileBrowserContentComponent, {
		props: { layout: 'grid' },
		global: {
			provide: { [FILE_BROWSER_CONTEXT_KEY as symbol]: contexto() },
			// La transición de verdad: la que sustituye VTU no avisa de nada.
			stubs: {
				transition: false,
				FileBrowserLoadingComponent: { template: '<div data-rama="cargando" />' },
				FileBrowserErrorComponent: { template: '<div data-rama="error" />' },
				FileBrowserGridView: Cuadricula,
			},
		},
	});
	return vista;
}

const ramas = () =>
	[...(vista?.element.querySelectorAll('[data-rama]') ?? [])].map((e) =>
		e.getAttribute('data-rama')
	);

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	isLoading.value = false;
	error.value = null;
	vacio.value = false;
	ruta.value = '/casa';
	montajesDeLaCuadricula = 0;
	avisos = spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	vista?.unmount();
	vista = null;
	avisos.mockRestore();
});

describe('el contenido del navegador', () => {
	test('con la carpeta cargada dibuja sólo las entradas', () => {
		montar();
		expect(ramas()).toEqual(['cuadricula']);
	});

	test('mientras carga dibuja sólo el esqueleto, aunque haya error o esté vacía', async () => {
		isLoading.value = true;
		error.value = 'x';
		vacio.value = true;
		montar();
		await nextTick();
		expect(ramas()).toEqual(['cargando']);
	});

	test('el error tiene prioridad sobre el estado vacío', () => {
		error.value = 'sin permiso';
		vacio.value = true;
		montar();
		expect(ramas()).toEqual(['error']);
	});

	test('una carpeta vacía no dibuja entradas', () => {
		vacio.value = true;
		montar();
		expect(ramas()).toEqual([]);
		expect(vista?.html()).toContain('directoryIsEmpty');
	});

	test('la transición recibe un solo hijo elemento en cada rama, sin avisos de Vue', async () => {
		montar();
		isLoading.value = true;
		await nextTick();
		isLoading.value = false;
		await nextTick();
		error.value = 'x';
		await nextTick();
		error.value = null;
		vacio.value = true;
		await nextTick();
		vacio.value = false;
		await nextTick();

		const deTransicion = avisos.mock.calls
			.map((llamada: unknown[]) => llamada.join(' '))
			.filter((texto: string) => /Transition|non-element|multiple/i.test(texto));
		expect(deTransicion).toEqual([]);
	});

	test('al cambiar de carpeta el contenido se vuelve a montar, para que transicione', async () => {
		montar();
		expect(montajesDeLaCuadricula).toBe(1);

		ruta.value = '/casa/otra';
		// La salida y la entrada de `out-in` esperan al fin de la transición, que
		// acá llega en un cuadro o dos: se espera a la condición, no un tiempo.
		for (let cuadro = 0; cuadro < 60 && montajesDeLaCuadricula < 2; cuadro++) {
			await new Promise((listo) => requestAnimationFrame(listo));
		}

		expect(montajesDeLaCuadricula).toBe(2);
		expect(ramas()).toEqual(['cuadricula']);
	});
});
