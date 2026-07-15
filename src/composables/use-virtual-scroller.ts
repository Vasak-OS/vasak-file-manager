import {
	type CSSProperties,
	type ComputedRef,
	type Ref,
	computed,
	onMounted,
	onUnmounted,
	ref,
	watch,
} from 'vue';
import type { Layout } from '@/types/navigator';

export interface VirtualScrollerOptions {
	/** Total de entradas en el directorio */
	totalItems: Ref<number>;
	/** Altura/tamaño de cada elemento (fijo para lista, calculado para grid) */
	itemSize: Ref<number>;
	/** Referencia al contenedor de scroll */
	containerRef: Ref<HTMLElement | null>;
	/** Margen de elementos extra arriba/abajo del viewport */
	overscan?: number;
	/** Layout actual */
	layout: Ref<Layout>;
	/** Columnas en grid (se calcula dinámicamente) */
	columns?: Ref<number>;
}

export interface VirtualScrollerReturn {
	/** Rango de índices visibles [start, end) */
	visibleRange: ComputedRef<{ start: number; end: number }>;
	/** Estilos del contenedor interno (height total) */
	containerStyle: ComputedRef<CSSProperties>;
	/** Offset de traducción para posicionar los items */
	offsetY: ComputedRef<number>;
	/** Total de nodos DOM renderizados actualmente */
	renderedCount: ComputedRef<number>;
	/** Scroll hasta un índice específico */
	scrollToIndex: (index: number, align?: 'start' | 'center' | 'nearest') => void;
	/** Mantener item visible al cambiar de layout */
	preserveScrollPosition: () => { index: number; offset: number };
	/** Restaurar posición tras cambio de layout */
	restoreScrollPosition: (saved: { index: number; offset: number }) => void;
}

/** Máximo absoluto de nodos DOM renderizados (Requirement 1.6) */
const MAX_DOM_NODES = 200;

/** Overscan por defecto (Requirement 1.1) */
const DEFAULT_OVERSCAN = 5;

/**
 * Composable de scroll virtualizado para el File Browser.
 *
 * Renderiza únicamente los elementos visibles en el viewport más un margen
 * configurable (overscan), reciclando nodos DOM y limitando a un máximo
 * absoluto de 200 nodos independientemente del total de entradas.
 *
 * Soporta layouts grid (múltiples columnas) y list (una columna).
 */
export function useVirtualScroller(options: VirtualScrollerOptions): VirtualScrollerReturn {
	const {
		totalItems,
		itemSize,
		containerRef,
		overscan = DEFAULT_OVERSCAN,
		layout,
		columns,
	} = options;

	const scrollTop = ref(0);
	const viewportHeight = ref(0);

	// --- Helpers ---

	/** Número efectivo de columnas según layout */
	const effectiveColumns = computed(() => {
		if (layout.value === 'list' || layout.value === 'compactList') {
			return 1;
		}
		return columns?.value ?? 1;
	});

	/** Total de filas necesarias para contener todos los items */
	const totalRows = computed(() => {
		const cols = effectiveColumns.value;
		if (cols <= 0) return 0;
		return Math.ceil(totalItems.value / cols);
	});

	/** Altura total del contenido virtualizado (scroll height) */
	const totalHeight = computed(() => {
		return totalRows.value * itemSize.value;
	});

	// --- Cálculo de rango visible ---

	const visibleRange = computed<{ start: number; end: number }>(() => {
		const total = totalItems.value;
		if (total === 0 || itemSize.value <= 0) {
			return { start: 0, end: 0 };
		}

		const cols = effectiveColumns.value;
		const rowHeight = itemSize.value;

		// Fila visible inicial (sin overscan)
		const startRow = Math.floor(scrollTop.value / rowHeight);
		// Filas visibles en el viewport
		const visibleRows = Math.ceil(viewportHeight.value / rowHeight);
		// Fila final visible (sin overscan)
		const endRow = startRow + visibleRows;

		// Aplicar overscan (en filas)
		const startRowWithOverscan = Math.max(0, startRow - overscan);
		const endRowWithOverscan = Math.min(totalRows.value, endRow + overscan);

		// Convertir filas a índices de items
		let start = startRowWithOverscan * cols;
		let end = endRowWithOverscan * cols;

		// Clampar al total real de items
		start = Math.max(0, Math.min(start, total));
		end = Math.max(start, Math.min(end, total));

		// Aplicar límite absoluto de MAX_DOM_NODES
		const maxItems = MAX_DOM_NODES;
		if (end - start > maxItems) {
			end = start + maxItems;
		}

		return { start, end };
	});

	const containerStyle = computed<CSSProperties>(() => ({
		height: `${totalHeight.value}px`,
		position: 'relative',
	}));

	const offsetY = computed(() => {
		if (totalItems.value === 0 || itemSize.value <= 0) {
			return 0;
		}
		const cols = effectiveColumns.value;
		const startRow = Math.floor(visibleRange.value.start / cols);
		return startRow * itemSize.value;
	});

	const renderedCount = computed(() => {
		const { start, end } = visibleRange.value;
		return end - start;
	});

	// --- Scroll event handling ---

	let scrollRAF: number | null = null;

	function onScroll() {
		if (scrollRAF !== null) return;
		scrollRAF = requestAnimationFrame(() => {
			scrollRAF = null;
			const el = containerRef.value;
			if (el) {
				scrollTop.value = el.scrollTop;
			}
		});
	}

	function updateViewportHeight() {
		const el = containerRef.value;
		if (el) {
			viewportHeight.value = el.clientHeight;
		}
	}

	let resizeObserver: ResizeObserver | null = null;

	function attachListeners(el: HTMLElement) {
		el.addEventListener('scroll', onScroll, { passive: true });
		resizeObserver = new ResizeObserver(() => {
			updateViewportHeight();
		});
		resizeObserver.observe(el);
		updateViewportHeight();
		scrollTop.value = el.scrollTop;
	}

	function detachListeners(el: HTMLElement) {
		el.removeEventListener('scroll', onScroll);
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
		if (scrollRAF !== null) {
			cancelAnimationFrame(scrollRAF);
			scrollRAF = null;
		}
	}

	// Watch for containerRef changes to attach/detach listeners
	watch(
		containerRef,
		(newEl, oldEl) => {
			if (oldEl) detachListeners(oldEl);
			if (newEl) attachListeners(newEl);
		},
		{ immediate: true },
	);

	onMounted(() => {
		if (containerRef.value) {
			attachListeners(containerRef.value);
		}
	});

	onUnmounted(() => {
		if (containerRef.value) {
			detachListeners(containerRef.value);
		}
	});

	// --- API methods ---

	function scrollToIndex(index: number, align: 'start' | 'center' | 'nearest' = 'start') {
		const el = containerRef.value;
		if (!el || itemSize.value <= 0) return;

		const cols = effectiveColumns.value;
		const row = Math.floor(index / cols);
		const rowTop = row * itemSize.value;
		const rowBottom = rowTop + itemSize.value;
		const currentScrollTop = el.scrollTop;
		const currentViewportHeight = el.clientHeight;

		let targetScrollTop: number;

		switch (align) {
			case 'start':
				targetScrollTop = rowTop;
				break;
			case 'center':
				targetScrollTop = rowTop - currentViewportHeight / 2 + itemSize.value / 2;
				break;
			case 'nearest': {
				// Si ya es visible, no scrollear
				if (rowTop >= currentScrollTop && rowBottom <= currentScrollTop + currentViewportHeight) {
					return;
				}
				// Si está por encima, alinear al inicio
				if (rowTop < currentScrollTop) {
					targetScrollTop = rowTop;
				} else {
					// Si está por debajo, alinear al final
					targetScrollTop = rowBottom - currentViewportHeight;
				}
				break;
			}
		}

		// Clampar dentro de límites válidos
		const maxScrollTop = Math.max(0, totalHeight.value - currentViewportHeight);
		targetScrollTop = Math.max(0, Math.min(targetScrollTop!, maxScrollTop));

		el.scrollTop = targetScrollTop;
		scrollTop.value = targetScrollTop;
	}

	function preserveScrollPosition(): { index: number; offset: number } {
		const cols = effectiveColumns.value;
		const rowHeight = itemSize.value;

		if (rowHeight <= 0) {
			return { index: 0, offset: 0 };
		}

		// Calcular el primer índice visible y su offset relativo
		const firstVisibleRow = Math.floor(scrollTop.value / rowHeight);
		const firstVisibleIndex = firstVisibleRow * cols;
		const offset = scrollTop.value - firstVisibleRow * rowHeight;

		return { index: firstVisibleIndex, offset };
	}

	function restoreScrollPosition(saved: { index: number; offset: number }) {
		const el = containerRef.value;
		if (!el || itemSize.value <= 0) return;

		const cols = effectiveColumns.value;
		const row = Math.floor(saved.index / cols);
		const targetScrollTop = row * itemSize.value + saved.offset;

		const maxScrollTop = Math.max(0, totalHeight.value - el.clientHeight);
		const clamped = Math.max(0, Math.min(targetScrollTop, maxScrollTop));

		el.scrollTop = clamped;
		scrollTop.value = clamped;
	}

	return {
		visibleRange,
		containerStyle,
		offsetY,
		renderedCount,
		scrollToIndex,
		preserveScrollPosition,
		restoreScrollPosition,
	};
}
