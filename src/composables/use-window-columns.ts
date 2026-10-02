/**
 * Cuántas columnas entran en la ventana: el formato de siempre, o una por vez.
 *
 * En el ancho habitual la ventana tiene tres columnas —la barra lateral, los
 * archivos y el panel de información— y la vista dividida pone dos paneles uno
 * al lado del otro. Por debajo de `ONE_COLUMN_MAX_WIDTH` eso no entra: el panel
 * de información se salía por la derecha y la vista dividida dejaba dos tiras
 * de 120 píxeles. Ahí la ventana pasa a una columna por vez, como una
 * aplicación de teléfono: la información se abre en lugar de los archivos (con
 * un botón para volver) y los dos paneles de la vista dividida se apilan.
 *
 * Por debajo de `COMPACT_MAX_WIDTH` ni siquiera entra la tira de iconos de la
 * barra lateral al lado de los archivos: la barra se abre encima, como un
 * cajón, desde un botón de la barra de la ventana.
 *
 * # Por qué se mide la ventana y no la pantalla
 *
 * La que decide es la raíz de la ventana, con un `ResizeObserver`: en WebKitGTK
 * ni `matchMedia` ni `resize` avisan (memoria `webkitgtk-no-avisa-de-resize`), y
 * un punto de corte de la pantalla no sabe en qué ventana está. Es un solo
 * número en un solo lugar: lo que cambia con él cambia de **contenido** (qué
 * columna se ve, si los botones van a un menú), no sólo de aspecto, así que no
 * va por consultas de contenedor.
 */
import { computed, type InjectionKey, inject, onBeforeUnmount, type Ref, ref, watch } from 'vue';

/** Por debajo de esto, una columna por vez. Es el `md:` que usaba la barra lateral. */
export const ONE_COLUMN_MAX_WIDTH = 768;

/** Por debajo de esto, la barra lateral va encima de los archivos. */
export const COMPACT_MAX_WIDTH = 480;

/** La columna que se ve cuando entra una sola. */
export type SingleColumn = 'files' | 'info';

export interface WindowColumns {
	/** El ancho de la ventana, en píxeles. Cero hasta la primera medida. */
	width: Ref<number>;
	/** Si entra una columna por vez. */
	isOneColumn: Ref<boolean>;
	/** Si la barra lateral va como cajón encima de los archivos. */
	isCompact: Ref<boolean>;
	/** En una columna por vez, cuál se ve. */
	column: Ref<SingleColumn>;
	/** Si el cajón de la barra lateral está abierto (sólo en compacto). */
	isSidebarOpen: Ref<boolean>;
}

export const WINDOW_COLUMNS_KEY: InjectionKey<WindowColumns> = Symbol('window-columns');

/** El formato que corresponde a un ancho. Sin medida todavía, el de siempre. */
export function columnsFor(width: number): { isOneColumn: boolean; isCompact: boolean } {
	if (width <= 0) return { isOneColumn: false, isCompact: false };
	return { isOneColumn: width < ONE_COLUMN_MAX_WIDTH, isCompact: width < COMPACT_MAX_WIDTH };
}

/**
 * Mide la raíz que se le pasa y arma el estado.
 *
 * Quien la llama (la maqueta de la ventana) lo `provide`-a con
 * `WINDOW_COLUMNS_KEY`; los componentes de adentro lo leen con
 * `useWindowColumns()`.
 */
export function createWindowColumns(
	root: Ref<HTMLElement | null | { $el?: unknown }>
): WindowColumns {
	const width = ref(0);
	const column = ref<SingleColumn>('files');
	const isSidebarOpen = ref(false);
	const isOneColumn = computed(() => columnsFor(width.value).isOneColumn);
	const isCompact = computed(() => columnsFor(width.value).isCompact);

	let observer: ResizeObserver | null = null;

	function elementOf(value: unknown): HTMLElement | null {
		if (value instanceof HTMLElement) return value;
		const element = (value as { $el?: unknown } | null)?.$el;
		return element instanceof HTMLElement ? element : null;
	}

	watch(
		root,
		(value) => {
			observer?.disconnect();
			const element = elementOf(value);
			if (!element) return;
			width.value = element.getBoundingClientRect().width;
			if (typeof ResizeObserver === 'undefined') return;
			observer = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (entry) width.value = entry.contentRect.width;
			});
			observer.observe(element);
		},
		{ immediate: true, flush: 'post' }
	);

	// Al volver al ancho habitual no queda nada abierto encima: la información
	// vuelve a su columna y la barra lateral a su lugar.
	watch(isOneColumn, (one) => {
		if (!one) column.value = 'files';
	});
	watch(isCompact, (compact) => {
		if (!compact) isSidebarOpen.value = false;
	});

	onBeforeUnmount(() => observer?.disconnect());

	return { width, isOneColumn, isCompact, column, isSidebarOpen };
}

/**
 * El estado de la ventana, para un componente de adentro.
 *
 * Fuera de la maqueta (una prueba que monta un componente suelto) devuelve el
 * formato de siempre, que es lo que esos componentes conocían.
 */
export function useWindowColumns(): WindowColumns {
	const provided = inject(WINDOW_COLUMNS_KEY, null);
	if (provided) return provided;
	return {
		width: ref(0),
		isOneColumn: ref(false),
		isCompact: ref(false),
		column: ref<SingleColumn>('files'),
		isSidebarOpen: ref(false),
	};
}
