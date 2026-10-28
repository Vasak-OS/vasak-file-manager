/**
 * Columnas de la lista que se adaptan al ancho del panel (#139).
 *
 * En un panel angosto (una mitad de la vista dividida, una ventana chica) las
 * columnas secundarias quedaban apretadas y cortadas por el borde. Ahora se
 * esconden de la más prescindible a la menos —modificado, tamaño, elementos—.
 *
 * Se prueba por capas: la cuenta pura (`columnsForWidth`), las dos vistas que
 * dibujan celdas (la lista y su esqueleto), que honran la visibilidad que les
 * baja el padre, y el contenido entero, que mide su panel y combina el ancho
 * con lo que la persona eligió. Equivocarse acá no da un error: deja la
 * plantilla del grid con más columnas que celdas y todo corrido, y eso sólo se
 * ve mirando.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, defineComponent, h, nextTick, type PropType, ref } from 'vue';
import FileBrowserContentComponent from '@/components/filebrowser/FileBrowserContentComponent.vue';
import FileBrowserLoadingComponent from '@/components/filebrowser/FileBrowserLoadingComponent.vue';
import {
	columnsForWidth,
	HIDE_ITEMS_BELOW,
	HIDE_MODIFIED_BELOW,
	HIDE_SIZE_BELOW,
	type ListColumnVisibility,
} from '@/composables/file-browser/list-columns';
import {
	FILE_BROWSER_CONTEXT_KEY,
	type FileBrowserContext,
} from '@/composables/file-browser/use-file-browser-context';
import { formatBytes } from '@/utils/byte-parser';
import { formatDate } from '@/utils/date-formatter';
import FileBrowserListView from '@/views/filebrowser/FileBrowserListView.vue';
import { olvidarTodo, responder } from './dobles';
import { archivo } from './support/dir-entry';

const TODAS: ListColumnVisibility = { items: true, size: true, modified: true };

describe('qué columnas entran en un ancho', () => {
	test('los umbrales son los que dice el diseño', () => {
		expect(HIDE_MODIFIED_BELOW).toBe(560);
		expect(HIDE_SIZE_BELOW).toBe(420);
		expect(HIDE_ITEMS_BELOW).toBe(320);
	});

	test('con un panel ancho entran las tres columnas', () => {
		expect(columnsForWidth(900)).toEqual(TODAS);
		expect(columnsForWidth(560)).toEqual(TODAS);
	});

	test('sin medida todavía (infinito) entran todas: se dibuja el formato ancho', () => {
		expect(columnsForWidth(Number.POSITIVE_INFINITY)).toEqual(TODAS);
	});

	test('el borde es inclusivo: justo en el umbral la columna se queda, un píxel menos se va', () => {
		expect(columnsForWidth(HIDE_MODIFIED_BELOW).modified).toBe(true);
		expect(columnsForWidth(HIDE_MODIFIED_BELOW - 1).modified).toBe(false);

		expect(columnsForWidth(HIDE_SIZE_BELOW).size).toBe(true);
		expect(columnsForWidth(HIDE_SIZE_BELOW - 1).size).toBe(false);

		expect(columnsForWidth(HIDE_ITEMS_BELOW).items).toBe(true);
		expect(columnsForWidth(HIDE_ITEMS_BELOW - 1).items).toBe(false);
	});

	test('primero se va «modificado», sin tocar las otras dos', () => {
		expect(columnsForWidth(559)).toEqual({ items: true, size: true, modified: false });
		expect(columnsForWidth(420)).toEqual({ items: true, size: true, modified: false });
	});

	test('después se va «tamaño», y «elementos» sigue', () => {
		expect(columnsForWidth(419)).toEqual({ items: true, size: false, modified: false });
		expect(columnsForWidth(320)).toEqual({ items: true, size: false, modified: false });
	});

	test('por último se va «elementos»: sólo queda el nombre', () => {
		expect(columnsForWidth(319)).toEqual({ items: false, size: false, modified: false });
		expect(columnsForWidth(0)).toEqual({ items: false, size: false, modified: false });
	});

	test('angostar nunca agrega una columna', () => {
		const contar = (c: ListColumnVisibility) => Object.values(c).filter(Boolean).length;
		let anterior = contar(columnsForWidth(1200));

		for (let ancho = 1200; ancho >= 0; ancho--) {
			const columnas = columnsForWidth(ancho);
			// Y se van en orden: si «tamaño» sigue, «elementos» también; si
			// «modificado» sigue, las otras dos también.
			if (columnas.modified) expect(columnas.size && columnas.items).toBe(true);
			if (columnas.size) expect(columnas.items).toBe(true);

			expect(contar(columnas)).toBeLessThanOrEqual(anterior);
			anterior = contar(columnas);
		}
	});
});

describe('el esqueleto de carga sigue las columnas', () => {
	let esqueleto: VueWrapper | null = null;

	afterEach(() => {
		esqueleto?.unmount();
		esqueleto = null;
	});

	/** Los esqueletos que dibuja una fila: el del nombre (un bloque y una barra) más uno por columna. */
	function esqueletosPorFila(columnVisibility?: ListColumnVisibility): number {
		esqueleto = mount(FileBrowserLoadingComponent, {
			props: columnVisibility ? { columnVisibility } : {},
		});
		const primeraFila = esqueleto.find('.grid');
		// Los dos del nombre quedan dentro de su propio `div`; el resto son hijos directos.
		return primeraFila.element.children.length - 1;
	}

	test('sin padre que decida dibuja los tres, como siempre', () => {
		expect(esqueletosPorFila()).toBe(3);
	});

	test('con todas las columnas dibuja tres esqueletos secundarios por fila', () => {
		expect(esqueletosPorFila(TODAS)).toBe(3);
	});

	test('esconde el esqueleto de la columna que el ancho sacó', () => {
		expect(esqueletosPorFila({ items: true, size: true, modified: false })).toBe(2);
		expect(esqueletosPorFila({ items: true, size: false, modified: false })).toBe(1);
		expect(esqueletosPorFila({ items: false, size: false, modified: false })).toBe(0);
	});

	test('saca justo el de la columna apagada y deja los otros', () => {
		const anchos = (columnVisibility: ListColumnVisibility) => {
			esqueletosPorFila(columnVisibility);
			return [...(esqueleto?.find('.grid').element.children ?? [])]
				.slice(1)
				.map((hijo) => (hijo as HTMLElement).style.width);
		};

		// items 30, size 50, modified 100.
		expect(anchos({ items: false, size: true, modified: true })).toEqual(['50px', '100px']);
		expect(anchos({ items: true, size: false, modified: true })).toEqual(['30px', '100px']);
		expect(anchos({ items: true, size: true, modified: false })).toEqual(['30px', '50px']);
	});
});

describe('la fila de la lista sigue las columnas', () => {
	let lista: VueWrapper | null = null;
	const restaurar: Array<() => void> = [];

	const modificada = 1_700_000_000;
	const entradas = [archivo('a.txt', { size: 2048, modified_time: modificada })];

	/** El contexto mínimo que la vista pide para montar. */
	function contexto(): FileBrowserContext {
		return {
			entries: computed(() => entradas),
			currentPath: computed(() => '/casa'),
			isLoading: ref(false),
			isDirectoryEmpty: computed(() => false),
			error: ref(null),
			selectedEntries: ref([]),
			isEntrySelected: () => false,
			contextMenu: ref({ visible: false, x: 0, y: 0, entry: null }),
			getVideoThumbnail: () => undefined,
			setEntriesContainerRef: () => {},
			registrarSeccionesVisuales: () => {},
			registrarDesplazamiento: () => {},
			onEntryMouseDown: () => {},
			onEntryMouseUp: () => {},
			openEntryContextMenu: () => {},
			onContextMenuAction: () => {},
			openOpenWithDialog: () => {},
			navigateToHome: () => {},
		} as unknown as FileBrowserContext;
	}

	/** Un alto de verdad para que el desplazador dibuje: en el DOM de pruebas todo mide cero. */
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
		restaurar.push(() => {
			Element.prototype.getBoundingClientRect = rectangulo;
			if (descriptor) Object.defineProperty(window, 'innerHeight', descriptor);
		});
	}

	beforeEach(() => {
		setActivePinia(createPinia());
		olvidarTodo();
		responder('get_active_calculations', []);
		conAltoDeVentana(900);
	});

	afterEach(() => {
		lista?.unmount();
		lista = null;
		for (const deshacer of restaurar.splice(0)) deshacer();
	});

	/** Los textos de las celdas secundarias de la primera fila, en orden. */
	async function celdas(columnVisibility?: ListColumnVisibility): Promise<string[]> {
		lista = mount(FileBrowserListView, {
			props: columnVisibility ? { entries: entradas, columnVisibility } : { entries: entradas },
			global: { provide: { [FILE_BROWSER_CONTEXT_KEY as symbol]: contexto() } },
			attachTo: document.body,
		});
		for (let paso = 0; paso < 8; paso++) await nextTick();

		const fila = lista.find('[data-entry-path]');
		expect(fila.exists()).toBe(true);
		return [...fila.element.children]
			.filter((hijo) => hijo.tagName === 'SPAN')
			.map((hijo) => hijo.textContent?.trim() ?? '');
	}

	const tamano = formatBytes(2048);
	const fecha = formatDate(modificada);

	test('sin padre que decida muestra las tres celdas', async () => {
		expect(await celdas()).toEqual(['—', tamano, fecha]);
	});

	test('con todas las columnas muestra las tres celdas', async () => {
		expect(await celdas(TODAS)).toEqual(['—', tamano, fecha]);
	});

	test('sin «modificado» la fila no dibuja la fecha', async () => {
		expect(await celdas({ items: true, size: true, modified: false })).toEqual(['—', tamano]);
	});

	test('sin «tamaño» la fila no dibuja el tamaño', async () => {
		expect(await celdas({ items: true, size: false, modified: true })).toEqual(['—', fecha]);
	});

	test('sin «elementos» la fila no dibuja la cuenta', async () => {
		expect(await celdas({ items: false, size: true, modified: true })).toEqual([tamano, fecha]);
	});

	test('con todas apagadas queda sólo el nombre', async () => {
		expect(await celdas({ items: false, size: false, modified: false })).toEqual([]);
	});

	test('cambiar las columnas con la lista ya montada actualiza las celdas', async () => {
		await celdas(TODAS);
		await lista?.setProps({ columnVisibility: { items: false, size: false, modified: false } });
		await nextTick();

		const fila = lista?.find('[data-entry-path]');
		const spans = [...(fila?.element.children ?? [])].filter((hijo) => hijo.tagName === 'SPAN');
		expect(spans).toEqual([]);
	});
});

describe('el contenido mide su panel y esconde columnas', () => {
	const realResizeObserver = globalThis.ResizeObserver;
	let observadores: Array<{ avisar: (ancho: number) => void }> = [];

	class ObservadorFalso {
		private objetivo: Element | null = null;
		constructor(private readonly llamar: ResizeObserverCallback) {
			observadores.push(this);
		}
		observe(objetivo: Element) {
			this.objetivo = objetivo;
		}
		avisar(ancho: number) {
			this.llamar(
				[
					{
						target: this.objetivo,
						contentRect: { width: ancho },
					} as unknown as ResizeObserverEntry,
				],
				this as unknown as ResizeObserver
			);
		}
		unobserve() {}
		disconnect() {}
	}

	/** La lista de mentira: no dibuja filas, sólo deja ver qué columnas le bajaron. */
	const ListaDeMentira = defineComponent({
		props: { columnVisibility: { type: Object as PropType<ListColumnVisibility>, default: null } },
		setup(props) {
			return () =>
				h('div', {
					'data-rama': 'lista',
					'data-columnas': JSON.stringify(props.columnVisibility),
				});
		},
	});

	const EsqueletoDeMentira = defineComponent({
		props: { columnVisibility: { type: Object as PropType<ListColumnVisibility>, default: null } },
		setup(props) {
			return () =>
				h('div', {
					'data-rama': 'cargando',
					'data-columnas': JSON.stringify(props.columnVisibility),
				});
		},
	});

	const cargando = ref(false);
	let contenido: VueWrapper | null = null;

	function contexto(): FileBrowserContext {
		return {
			entries: computed(() => []),
			currentPath: computed(() => '/casa'),
			isLoading: cargando,
			isDirectoryEmpty: computed(() => false),
			error: ref(null),
			listSortColumn: ref(null),
			listSortDirection: ref('asc'),
			selectedEntries: ref([]),
			isEntrySelected: () => false,
			contextMenu: ref({ visible: false, x: 0, y: 0, entry: null }),
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
		} as unknown as FileBrowserContext;
	}

	async function montar() {
		globalThis.ResizeObserver = ObservadorFalso as unknown as typeof ResizeObserver;
		contenido = mount(FileBrowserContentComponent, {
			props: { layout: 'list' },
			global: {
				provide: { [FILE_BROWSER_CONTEXT_KEY as symbol]: contexto() },
				stubs: {
					transition: false,
					FileBrowserLoadingComponent: EsqueletoDeMentira,
					FileBrowserListView: ListaDeMentira,
					FileBrowserErrorComponent: { template: '<div data-rama="error" />' },
				},
			},
			attachTo: document.body,
		});
		await nextTick();
		await nextTick();
	}

	/** Informa el ancho del panel, como lo haría el navegador al maquetar. */
	async function ancharA(ancho: number) {
		for (const observador of observadores) observador.avisar(ancho);
		await nextTick();
	}

	/** Los títulos de columna que dibuja el encabezado, en orden. */
	function titulos(): string[] {
		const encabezado = contenido?.find('.grid');
		return [...(encabezado?.element.querySelectorAll('button') ?? [])].map(
			(boton) => boton.textContent?.trim() ?? ''
		);
	}

	const plantilla = () =>
		(contenido?.element as HTMLElement | undefined)?.style.getPropertyValue(
			'--file-browser-list-columns'
		) ?? '';

	const columnasDe = (rama: string): ListColumnVisibility =>
		JSON.parse(contenido?.find(`[data-rama="${rama}"]`).attributes('data-columnas') ?? 'null');

	beforeEach(() => {
		setActivePinia(createPinia());
		olvidarTodo();
		cargando.value = false;
		observadores = [];
	});

	afterEach(() => {
		contenido?.unmount();
		contenido = null;
		globalThis.ResizeObserver = realResizeObserver;
	});

	test('antes de la primera medida se dibuja el formato ancho de siempre', async () => {
		await montar();

		expect(titulos()).toEqual([
			'fileBrowser.name',
			'fileBrowser.items',
			'fileBrowser.size',
			'fileBrowser.modified',
		]);
		expect(plantilla()).toBe('minmax(80px, 1fr) minmax(0, 90px) minmax(0, 100px) minmax(0, 160px)');
		expect(columnasDe('lista')).toEqual(TODAS);
	});

	test('en un panel ancho el encabezado y la plantilla llevan las tres columnas', async () => {
		await montar();
		await ancharA(900);

		expect(titulos()).toHaveLength(4);
		expect(plantilla()).toBe('minmax(80px, 1fr) minmax(0, 90px) minmax(0, 100px) minmax(0, 160px)');
		expect(columnasDe('lista')).toEqual(TODAS);
	});

	test('al angostar el panel se va «modificado» del encabezado, la plantilla y la lista', async () => {
		await montar();
		await ancharA(500);

		expect(titulos()).toEqual(['fileBrowser.name', 'fileBrowser.items', 'fileBrowser.size']);
		expect(plantilla()).toBe('minmax(80px, 1fr) minmax(0, 90px) minmax(0, 100px)');
		expect(columnasDe('lista')).toEqual({ items: true, size: true, modified: false });
	});

	test('más angosto se va también «tamaño»', async () => {
		await montar();
		await ancharA(380);

		expect(titulos()).toEqual(['fileBrowser.name', 'fileBrowser.items']);
		expect(plantilla()).toBe('minmax(80px, 1fr) minmax(0, 90px)');
		expect(columnasDe('lista')).toEqual({ items: true, size: false, modified: false });
	});

	test('en un panel mínimo queda sólo el nombre', async () => {
		await montar();
		await ancharA(250);

		expect(titulos()).toEqual(['fileBrowser.name']);
		expect(plantilla()).toBe('minmax(80px, 1fr)');
		expect(columnasDe('lista')).toEqual({ items: false, size: false, modified: false });
	});

	test('al volver a ensanchar las columnas vuelven', async () => {
		await montar();
		await ancharA(250);
		await ancharA(900);

		expect(titulos()).toHaveLength(4);
		expect(columnasDe('lista')).toEqual(TODAS);
	});

	test('el esqueleto de carga recibe las mismas columnas que la lista', async () => {
		cargando.value = true;
		await montar();
		await ancharA(380);
		await nextTick();

		expect(columnasDe('cargando')).toEqual({ items: true, size: false, modified: false });
	});
});
