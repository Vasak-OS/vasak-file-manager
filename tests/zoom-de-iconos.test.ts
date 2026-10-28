/**
 * El zoom de los íconos y las tarjetas (#134).
 *
 * El nivel es discreto —cinco escalones— porque cada uno tiene un alto fijo y
 * así los desplazadores virtuales no remiden tarjeta por tarjeta. Se prueba por
 * capas: el cálculo de los escalones, que sobreviva a cerrar la ventana
 * (el nivel vive en la pestaña), que Ctrl+rueda lo mueva sin robarle la rueda
 * al desplazamiento normal, y que las dos vistas lo dibujen.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue';
import FileBrowserContentComponent from '@/components/filebrowser/FileBrowserContentComponent.vue';
import {
	clampIconScale,
	DEFAULT_ICON_SCALE,
	ICON_SCALE_LEVELS,
	stepIconScale,
} from '@/composables/file-browser/icon-scale';
import { useFileBrowser } from '@/composables/file-browser/use-file-browser';
import {
	FILE_BROWSER_CONTEXT_KEY,
	type FileBrowserContext,
} from '@/composables/file-browser/use-file-browser-context';
import { parseWorkspaces } from '@/stores/scheme/workspaces';
import type { DirEntry } from '@/types/dir-entry';
import type { Tab } from '@/types/workspaces';
import FileBrowserGridView from '@/views/filebrowser/FileBrowserGridView.vue';
import FileBrowserListView from '@/views/filebrowser/FileBrowserListView.vue';
import { olvidarTodo, responder } from './dobles';

describe('los niveles de zoom', () => {
	test('el nivel por defecto es 1 y es uno de los niveles', () => {
		expect(DEFAULT_ICON_SCALE).toBe(1);
		expect(ICON_SCALE_LEVELS).toContain(DEFAULT_ICON_SCALE);
	});

	test('un nivel válido se queda como está', () => {
		for (const nivel of ICON_SCALE_LEVELS) {
			expect(clampIconScale(nivel)).toBe(nivel);
		}
	});

	test('un valor fuera de rango cae en el nivel válido más cercano', () => {
		expect(clampIconScale(0)).toBe(0.75);
		expect(clampIconScale(-3)).toBe(0.75);
		expect(clampIconScale(10)).toBe(2);
		expect(clampIconScale(1.1)).toBe(1);
		expect(clampIconScale(1.4)).toBe(1.5);
	});

	test('un valor entre dos niveles cae en el más cercano, no en uno intermedio', () => {
		for (const valor of [0.8, 0.9, 1.05, 1.3, 1.7, 1.95]) {
			expect(ICON_SCALE_LEVELS).toContain(clampIconScale(valor) as 0.75);
		}
	});

	test('subir recorre los niveles de a uno, en orden, y se queda en el tope', () => {
		const recorrido: number[] = [];
		let escala: number = ICON_SCALE_LEVELS[0];

		for (let paso = 0; paso < ICON_SCALE_LEVELS.length + 2; paso++) {
			escala = stepIconScale(escala, 1);
			recorrido.push(escala);
		}

		expect(recorrido).toEqual([1, 1.25, 1.5, 2, 2, 2, 2]);
	});

	test('bajar recorre los niveles de a uno, en orden, y se queda en el piso', () => {
		const recorrido: number[] = [];
		let escala: number = ICON_SCALE_LEVELS[ICON_SCALE_LEVELS.length - 1];

		for (let paso = 0; paso < ICON_SCALE_LEVELS.length + 2; paso++) {
			escala = stepIconScale(escala, -1);
			recorrido.push(escala);
		}

		expect(recorrido).toEqual([1.5, 1.25, 1, 0.75, 0.75, 0.75, 0.75]);
	});

	test('un valor suelto primero se ajusta al nivel y después se mueve', () => {
		// 1.1 es en realidad el nivel 1: subir da 1.25, no 1.1 + un escalón.
		expect(stepIconScale(1.1, 1)).toBe(1.25);
		expect(stepIconScale(1.1, -1)).toBe(0.75);
	});
});

const pestana = (extra: Record<string, unknown> = {}) => ({
	id: 't1',
	name: 'casa',
	path: '/casa',
	type: 'directory',
	paneWidth: 100,
	filterQuery: '',
	...extra,
});

function pestanaGuardada(extra: Record<string, unknown> = {}): Tab {
	const espacios = parseWorkspaces([
		{
			id: 1,
			isPrimary: true,
			isCurrent: true,
			name: 'primary',
			tabGroups: [[pestana(extra)]],
			currentTabGroupIndex: 0,
			currentTabIndex: 0,
		},
	]);
	return espacios?.[0].tabGroups[0][0] as Tab;
}

describe('el zoom que se guarda en la pestaña', () => {
	test('un nivel guardado se recupera al abrir', () => {
		expect(pestanaGuardada({ iconScale: 1.5 }).iconScale).toBe(1.5);
	});

	test('una pestaña guardada antes del zoom abre en el nivel por defecto', () => {
		expect(pestanaGuardada().iconScale).toBe(DEFAULT_ICON_SCALE);
	});

	test('un valor que no es número abre en el nivel por defecto', () => {
		for (const roto of ['grande', null, {}, Number.NaN]) {
			expect(pestanaGuardada({ iconScale: roto }).iconScale).toBe(DEFAULT_ICON_SCALE);
		}
	});

	test('un valor fuera de rango se ajusta al nivel más cercano', () => {
		expect(pestanaGuardada({ iconScale: 9 }).iconScale).toBe(2);
		expect(pestanaGuardada({ iconScale: 0.1 }).iconScale).toBe(0.75);
	});
});

describe('el zoom del navegador de archivos', () => {
	let montado: VueWrapper | null = null;

	beforeEach(() => {
		setActivePinia(createPinia());
		olvidarTodo();
		responder('get_active_calculations', []);
		// El agregador lee la carpeta de la pestaña al montarse.
		responder('read_dir', ({ path }) => ({
			path,
			entries: [],
			total_count: 0,
			dir_count: 0,
			file_count: 0,
		}));
	});

	afterEach(() => {
		montado?.unmount();
		montado = null;
	});

	/** Monta el agregador contra una pestaña de verdad y devuelve su API. */
	function montarAgregador(tab: Tab | undefined) {
		let api!: ReturnType<typeof useFileBrowser>;
		montado = mount(
			defineComponent({
				setup() {
					api = useFileBrowser({
						tab: () => tab,
						layout: () => 'grid',
						onSelectedEntriesChange: () => {},
						onCurrentDirEntryChange: () => {},
						onOpenEntry: () => {},
						componentRef: ref(null),
					});
					return () => h('div');
				},
			})
		);
		return api;
	}

	test('acercar y alejar mueven el nivel de a un escalón y quedan en la pestaña', async () => {
		const tab = reactive(pestanaGuardada({ iconScale: 1 })) as Tab;
		const fb = montarAgregador(tab);

		fb.zoomIn();
		expect(tab.iconScale).toBe(1.25);
		expect(fb.iconScale.value).toBe(1.25);

		fb.zoomIn();
		fb.zoomIn();
		fb.zoomIn();
		expect(tab.iconScale).toBe(2);

		fb.zoomOut();
		expect(tab.iconScale).toBe(1.5);
	});

	test('restablecer vuelve al nivel por defecto desde cualquier nivel', () => {
		for (const nivel of ICON_SCALE_LEVELS) {
			const tab = reactive(pestanaGuardada({ iconScale: nivel })) as Tab;
			const fb = montarAgregador(tab);
			montado?.unmount();

			fb.zoomReset();

			expect(tab.iconScale).toBe(DEFAULT_ICON_SCALE);
		}
	});

	test('cada pestaña lleva su propio nivel', () => {
		const una = reactive(pestanaGuardada({ iconScale: 1 })) as Tab;
		const otra = reactive(pestanaGuardada({ iconScale: 1 })) as Tab;
		const fbUna = montarAgregador(una);
		montado?.unmount();
		montarAgregador(otra);

		fbUna.zoomIn();

		expect(una.iconScale).toBe(1.25);
		expect(otra.iconScale).toBe(1);
	});

	test('una pestaña con un valor viejo fuera de rango se lee ya ajustado', () => {
		const tab = reactive(pestanaGuardada()) as Tab;
		tab.iconScale = 1.1;
		const fb = montarAgregador(tab);

		expect(fb.iconScale.value).toBe(1);
	});

	test('en la búsqueda global el zoom funciona pero no depende de ninguna pestaña', () => {
		let api!: ReturnType<typeof useFileBrowser>;
		montado = mount(
			defineComponent({
				setup() {
					api = useFileBrowser({
						tab: () => undefined,
						layout: () => 'grid',
						externalEntries: () => [],
						basePath: () => '/casa',
						onSelectedEntriesChange: () => {},
						onCurrentDirEntryChange: () => {},
						onOpenEntry: () => {},
						componentRef: ref(null),
					});
					return () => h('div');
				},
			})
		);

		api.zoomIn();
		expect(api.iconScale.value).toBe(1.25);
		api.zoomReset();
		expect(api.iconScale.value).toBe(DEFAULT_ICON_SCALE);
	});
});

const entradas = [
	{ name: 'a.txt', path: '/casa/a.txt', is_dir: false, is_file: true, size: 10 },
	{ name: 'carpeta', path: '/casa/carpeta', is_dir: true, is_file: false, size: 0 },
] as DirEntry[];

function contexto(extra: Partial<FileBrowserContext> = {}): FileBrowserContext {
	return {
		entries: computed(() => entradas),
		currentPath: computed(() => '/casa'),
		isLoading: ref(false),
		isDirectoryEmpty: computed(() => false),
		error: ref(null),
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
		...extra,
	} as FileBrowserContext;
}

describe('Ctrl + rueda sobre el área de archivos', () => {
	let vista: VueWrapper | null = null;
	let acercar = 0;
	let alejar = 0;

	beforeEach(() => {
		setActivePinia(createPinia());
		olvidarTodo();
		responder('get_active_calculations', []);
		acercar = 0;
		alejar = 0;
		vista = mount(FileBrowserContentComponent, {
			props: { layout: 'grid' },
			global: {
				provide: {
					[FILE_BROWSER_CONTEXT_KEY as symbol]: contexto({
						zoomIn: () => acercar++,
						zoomOut: () => alejar++,
					}),
				},
				stubs: {
					transition: false,
					FileBrowserGridView: defineComponent({
						setup: () => () => h('div', { 'data-rama': 'cuadricula' }),
					}),
				},
			},
			attachTo: document.body,
		});
	});

	afterEach(() => {
		vista?.unmount();
		vista = null;
	});

	function rueda(init: WheelEventInit): WheelEvent {
		const evento = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
		// El `WheelEvent` de happy-dom descarta las teclas modificadoras del init.
		for (const tecla of ['ctrlKey', 'metaKey'] as const) {
			Object.defineProperty(evento, tecla, { value: init[tecla] ?? false });
		}
		vista?.element.querySelector('[data-rama="cuadricula"]')?.dispatchEvent(evento);
		return evento;
	}

	test('hacia arriba con Ctrl acerca, y no deja que la página haga zoom', () => {
		const evento = rueda({ ctrlKey: true, deltaY: -100 });

		expect(acercar).toBe(1);
		expect(alejar).toBe(0);
		expect(evento.defaultPrevented).toBe(true);
	});

	test('hacia abajo con Ctrl aleja', () => {
		const evento = rueda({ ctrlKey: true, deltaY: 100 });

		expect(alejar).toBe(1);
		expect(acercar).toBe(0);
		expect(evento.defaultPrevented).toBe(true);
	});

	test('con Cmd (Mac) también hace zoom', () => {
		rueda({ metaKey: true, deltaY: -100 });

		expect(acercar).toBe(1);
	});

	test('sin Ctrl la rueda sigue desplazando: no hace zoom ni se cancela', () => {
		const evento = rueda({ deltaY: -100 });

		expect(acercar + alejar).toBe(0);
		expect(evento.defaultPrevented).toBe(false);
	});

	test('con Ctrl pero sin movimiento vertical no hace zoom', () => {
		rueda({ ctrlKey: true, deltaY: 0 });

		expect(acercar + alejar).toBe(0);
	});
});

describe('las vistas dibujan el nivel de zoom', () => {
	let montada: VueWrapper | null = null;

	beforeEach(() => {
		setActivePinia(createPinia());
		olvidarTodo();
		responder('get_active_calculations', []);
	});

	afterEach(() => {
		montada?.unmount();
		montada = null;
	});

	/** Un alto de verdad para que el desplazador dibuje (en el DOM de pruebas todo mide cero). */
	function conAltoDeVentana(alto: number) {
		const rectangulo = Element.prototype.getBoundingClientRect;
		const descriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
		Object.defineProperty(window, 'innerHeight', { value: alto, configurable: true });
		Element.prototype.getBoundingClientRect = () =>
			({
				top: 0,
				left: 0,
				bottom: alto,
				right: 900,
				width: 900,
				height: alto,
				x: 0,
				y: 0,
			}) as DOMRect;
		return () => {
			Element.prototype.getBoundingClientRect = rectangulo;
			if (descriptor) Object.defineProperty(window, 'innerHeight', descriptor);
		};
	}

	async function altoDeLasTarjetas(iconScale: number): Promise<string[]> {
		montada = mount(FileBrowserGridView, {
			props: { entries: entradas, iconScale },
			global: { provide: { [FILE_BROWSER_CONTEXT_KEY as symbol]: contexto() } },
			attachTo: document.body,
		});
		for (let paso = 0; paso < 8; paso++) await nextTick();

		return montada
			.findAll('[data-entry-path]')
			.map(
				(tarjeta) =>
					`${tarjeta.attributes('data-entry-path')}=${(tarjeta.element as HTMLElement).style.height}`
			);
	}

	test('la cuadrícula escala el alto de sus tarjetas con el nivel', async () => {
		const restaurar = conAltoDeVentana(900);
		try {
			const normal = await altoDeLasTarjetas(1);
			montada?.unmount();
			const grande = await altoDeLasTarjetas(2);

			// Carpeta: 72 px base; archivo: 120 px base.
			expect(normal).toContain('/casa/carpeta=72px');
			expect(normal).toContain('/casa/a.txt=120px');
			expect(grande).toContain('/casa/carpeta=144px');
			expect(grande).toContain('/casa/a.txt=240px');
		} finally {
			restaurar();
		}
	});

	test('la cuadrícula achica sus tarjetas con el nivel más chico', async () => {
		const restaurar = conAltoDeVentana(900);
		try {
			const chico = await altoDeLasTarjetas(0.75);

			expect(chico).toContain('/casa/carpeta=54px');
			expect(chico).toContain('/casa/a.txt=90px');
		} finally {
			restaurar();
		}
	});

	test('sin nivel la cuadrícula se dibuja al tamaño de siempre', async () => {
		const restaurar = conAltoDeVentana(900);
		try {
			montada = mount(FileBrowserGridView, {
				props: { entries: entradas },
				global: { provide: { [FILE_BROWSER_CONTEXT_KEY as symbol]: contexto() } },
				attachTo: document.body,
			});
			for (let paso = 0; paso < 8; paso++) await nextTick();

			const altos = montada
				.findAll('[data-entry-path]')
				.map((t) => (t.element as HTMLElement).style.height);
			expect(altos.sort()).toEqual(['120px', '72px']);
		} finally {
			restaurar();
		}
	});

	test('la lista vuelve a medir sus filas cuando cambia el nivel', async () => {
		montada = mount(FileBrowserListView, {
			props: { entries: entradas, iconScale: 1 },
			global: { provide: { [FILE_BROWSER_CONTEXT_KEY as symbol]: contexto() } },
			attachTo: document.body,
		});
		await nextTick();

		const dependencias = (
			montada.findComponent({ name: 'DynamicScrollerItem' }).props() as {
				sizeDependencies?: unknown[];
			}
		).sizeDependencies;
		expect(dependencias).toContain(1);

		await montada.setProps({ iconScale: 2 });
		await nextTick();

		const despues = (
			montada.findComponent({ name: 'DynamicScrollerItem' }).props() as {
				sizeDependencies?: unknown[];
			}
		).sizeDependencies;
		expect(despues).toContain(2);
	});
});
