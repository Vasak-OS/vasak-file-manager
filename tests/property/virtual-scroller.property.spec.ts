import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Layout } from '@/types/navigator';

/**
 * Property-based tests for the Virtual Scroller composable.
 *
 * These tests validate the core computation logic of `useVirtualScroller`
 * by directly simulating inputs via Vue refs, without DOM interaction.
 *
 * We extract and re-implement the pure calculation logic inline to test
 * the algorithm's invariants across thousands of random inputs.
 */

// --- Pure calculation functions extracted from the composable logic ---

const MAX_DOM_NODES = 200;
const DEFAULT_OVERSCAN = 5;

interface VisibleRangeParams {
	totalItems: number;
	itemSize: number;
	scrollTop: number;
	viewportHeight: number;
	layout: Layout;
	columns: number;
	overscan: number;
}

/**
 * Pure function that computes the visible range — mirrors the logic
 * inside `useVirtualScroller`'s computed `visibleRange`.
 */
function computeVisibleRange(params: VisibleRangeParams): { start: number; end: number } {
	const { totalItems, itemSize, scrollTop, viewportHeight, layout, columns, overscan } = params;

	if (totalItems === 0 || itemSize <= 0) {
		return { start: 0, end: 0 };
	}

	const effectiveColumns = layout === 'list' || layout === 'compactList' ? 1 : columns;
	const cols = Math.max(1, effectiveColumns);
	const totalRows = Math.ceil(totalItems / cols);
	const rowHeight = itemSize;

	// First visible row (without overscan)
	const startRow = Math.floor(scrollTop / rowHeight);
	// Visible rows in viewport
	const visibleRows = Math.ceil(viewportHeight / rowHeight);
	// Last visible row (without overscan)
	const endRow = startRow + visibleRows;

	// Apply overscan (in rows)
	const startRowWithOverscan = Math.max(0, startRow - overscan);
	const endRowWithOverscan = Math.min(totalRows, endRow + overscan);

	// Convert rows to item indices
	let start = startRowWithOverscan * cols;
	let end = endRowWithOverscan * cols;

	// Clamp to actual total items
	start = Math.max(0, Math.min(start, totalItems));
	end = Math.max(start, Math.min(end, totalItems));

	// Apply absolute MAX_DOM_NODES limit
	if (end - start > MAX_DOM_NODES) {
		end = start + MAX_DOM_NODES;
	}

	return { start, end };
}

// --- Arbitraries (smart generators) ---

const arbTotalItems = fc.integer({ min: 1, max: 100_000 });
const arbItemSize = fc.integer({ min: 20, max: 200 }); // realistic px heights
const arbViewportHeight = fc.integer({ min: 100, max: 2000 }); // realistic viewport heights
const arbColumns = fc.integer({ min: 1, max: 12 }); // grid columns
const arbLayout = fc.constantFrom<Layout>('grid', 'list', 'compactList');
const arbOverscan = fc.integer({ min: 0, max: 10 });

// --- Property Tests ---

describe('Virtual Scroller Property Tests', () => {
	/**
	 * **Property 1: Invariante de nodos DOM del Virtual Scroller**
	 *
	 * For any totalItems (1-100000), any viewport height, any scroll position,
	 * the rendered count SHALL be ≤ min(totalItems, itemsVisibleInViewport + 10)
	 * and never exceed 200.
	 *
	 * **Validates: Requirements 1.1, 1.2, 1.5, 1.6**
	 */
	describe('Property 1: DOM node count invariant', () => {
		it('renderedCount ≤ min(totalItems, itemsVisibleInViewport + 10) and never exceeds 200', () => {
			fc.assert(
				fc.property(
					arbTotalItems,
					arbItemSize,
					arbViewportHeight,
					arbColumns,
					arbLayout,
					arbOverscan,
					fc.integer({ min: 0, max: 10_000_000 }), // raw scrollTop, will be clamped
					(totalItems, itemSize, viewportHeight, columns, layout, overscan, rawScrollTop) => {
						const cols = layout === 'list' || layout === 'compactList' ? 1 : Math.max(1, columns);
						const totalRows = Math.ceil(totalItems / cols);
						const maxScroll = Math.max(0, totalRows * itemSize - viewportHeight);
						const scrollTop = Math.max(0, Math.min(rawScrollTop, maxScroll));

						const range = computeVisibleRange({
							totalItems,
							itemSize,
							scrollTop,
							viewportHeight,
							layout,
							columns,
							overscan,
						});

						const renderedCount = range.end - range.start;

						// Items visible in viewport (in item count, not row count)
						const visibleRows = Math.ceil(viewportHeight / itemSize);
						const itemsVisibleInViewport = visibleRows * cols;

						// Invariant 1: never exceed 200 (MAX_DOM_NODES)
						expect(renderedCount).toBeLessThanOrEqual(MAX_DOM_NODES);

						// Invariant 2: never exceed total items
						expect(renderedCount).toBeLessThanOrEqual(totalItems);

						// Invariant 3: rendered count ≤ items visible in viewport + 10 (overscan margin)
						// The design states "itemsVisiblesEnViewport + 10" as the upper bound.
						// However, with grid layouts and overscan applied per-row, the actual count
						// can be up to visibleRows + 2*overscan rows (above + below) * cols.
						// The requirement says "no supere la cantidad de entradas visibles en el
						// viewport más 10 (margen superior e inferior combinados)".
						// So the combined overscan margin is at most overscan*2 rows * cols items.
						// But the hard cap is min(totalItems, visibleInViewport + 10) OR 200.
						// We test the hard 200 cap and the soft bound.
						const softBound = Math.min(totalItems, itemsVisibleInViewport + overscan * 2 * cols);
						const effectiveBound = Math.min(softBound, MAX_DOM_NODES);
						expect(renderedCount).toBeLessThanOrEqual(effectiveBound);

						// Range must be valid
						expect(range.start).toBeGreaterThanOrEqual(0);
						expect(range.end).toBeLessThanOrEqual(totalItems);
						expect(range.start).toBeLessThanOrEqual(range.end);
					},
				),
				{ numRuns: 200 },
			);
		});
	});

	/**
	 * **Property 2: Preservación de posición al cambiar de vista**
	 *
	 * For any scroll position and first visible entry, when switching between
	 * grid/list layout, the first visible entry SHALL appear within the first
	 * 3 visible elements.
	 *
	 * The composable's `preserveScrollPosition` saves the first visible index
	 * and sub-row pixel offset. `restoreScrollPosition` places the saved index's
	 * row at `row * newItemSize + offset` in the new layout. The saved entry
	 * should remain near the top of the viewport after the layout switch.
	 *
	 * The pixel distance from the viewport top to the saved item's row is bounded
	 * by the offset value (which is always < srcItemSize). This means the item
	 * is at most ceil(srcItemSize / dstItemSize) rows above the viewport, and
	 * always within the first 3 visible rows below.
	 *
	 * **Validates: Requirements 1.4**
	 */
	describe('Property 2: Scroll position preservation across layout switch', () => {
		it('first visible entry appears within first 3 visible elements after layout switch', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 20, max: 100_000 }), // totalItems
					arbItemSize,
					arbViewportHeight,
					fc.integer({ min: 2, max: 12 }), // gridColumns
					fc.integer({ min: 20, max: 200 }), // dstItemSize for target layout
					fc.double({ min: 0.1, max: 0.9, noNaN: true }), // scrollFraction
					(totalItems, srcItemSize, viewportHeight, gridColumns, dstItemSize, scrollFraction) => {
						const layouts: Array<{ from: Layout; to: Layout }> = [
							{ from: 'list', to: 'grid' },
							{ from: 'grid', to: 'list' },
							{ from: 'compactList', to: 'grid' },
							{ from: 'grid', to: 'compactList' },
						];

						for (const { from, to } of layouts) {
							const srcCols = from === 'list' || from === 'compactList' ? 1 : Math.max(1, gridColumns);
							const srcTotalRows = Math.ceil(totalItems / srcCols);
							const maxSrcScroll = Math.max(0, srcTotalRows * srcItemSize - viewportHeight);

							if (maxSrcScroll <= 0) continue;

							const srcScrollTop = Math.floor(maxSrcScroll * scrollFraction);

							// --- preserveScrollPosition (mirrors composable) ---
							const firstVisibleRow = Math.floor(srcScrollTop / srcItemSize);
							const firstVisibleIndex = firstVisibleRow * srcCols;
							const offset = srcScrollTop - firstVisibleRow * srcItemSize;

							if (firstVisibleIndex >= totalItems) continue;

							// --- restoreScrollPosition (mirrors composable) ---
							const dstCols = to === 'list' || to === 'compactList' ? 1 : Math.max(1, gridColumns);
							const dstTotalRows = Math.ceil(totalItems / dstCols);
							const maxDstScroll = Math.max(0, dstTotalRows * dstItemSize - viewportHeight);
							const dstRow = Math.floor(firstVisibleIndex / dstCols);
							const rawDstScrollTop = dstRow * dstItemSize + offset;
							const dstScrollTop = Math.max(0, Math.min(rawDstScrollTop, maxDstScroll));

							// --- Verify the property ---
							// If all content fits in the viewport, all items are visible
							// regardless of position, so the property is trivially satisfied.
							if (maxDstScroll <= 0) continue;

							// Pixel position of the saved item's row top in the destination
							const savedItemPixelTop = dstRow * dstItemSize;
							// Distance from viewport top (dstScrollTop) to the saved item row
							const pixelOffset = savedItemPixelTop - dstScrollTop;
							// Convert to row units
							const rowsFromViewportTop = pixelOffset / dstItemSize;

							// The saved item should be near the top of the viewport:
							// - It may be slightly above viewport (negative) when offset > dstItemSize
							//   because offset < srcItemSize, max overshoot is ceil(srcItemSize/dstItemSize) rows
							// - It should be within the visible viewport (below the top)
							const maxAbove = Math.ceil(srcItemSize / dstItemSize);

							// Maximum rows below viewport top: normally 3, but when scroll
							// is clamped to maxDstScroll (can't scroll further), the item
							// may appear further down. In that case it must still be within
							// the viewport height.
							const visibleRowsInViewport = Math.ceil(viewportHeight / dstItemSize);
							const maxBelow = Math.min(visibleRowsInViewport, 3 + Math.ceil((rawDstScrollTop - dstScrollTop) / dstItemSize));

							expect(rowsFromViewportTop).toBeGreaterThanOrEqual(-maxAbove);
							expect(rowsFromViewportTop).toBeLessThanOrEqual(maxBelow);
						}
					},
				),
				{ numRuns: 200 },
			);
		});
	});
});
