import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { createBatchAccumulator } from '@/utils/event-throttle';

/**
 * Property 12: Agrupación de cambios del watcher
 *
 * Para cualquier secuencia de eventos de cambio del file watcher dentro de una
 * ventana de 500ms, el sistema SHALL agruparlos en un solo lote de actualización
 * con un máximo de 200 cambios por lote.
 *
 * **Validates: Requirements 6.4**
 */
describe('Property 12: Agrupación de cambios del watcher', () => {
	const INTERVAL = 500;
	const MAX_BATCH_SIZE = 200;

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('no single batch exceeds maxBatchSize (200)', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 500 }),
				(eventCount) => {
					const batches: number[][] = [];
					const accumulator = createBatchAccumulator<number>(
						(items) => batches.push([...items]),
						INTERVAL,
						MAX_BATCH_SIZE
					);

					for (let i = 0; i < eventCount; i++) {
						accumulator.push(i);
					}

					// Flush remaining items
					vi.advanceTimersByTime(INTERVAL * Math.ceil(eventCount / MAX_BATCH_SIZE));

					for (const batch of batches) {
						expect(batch.length).toBeLessThanOrEqual(MAX_BATCH_SIZE);
					}

					accumulator.cancel();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('total items across all emitted batches equals total pushed items', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 500 }),
				(eventCount) => {
					const batches: number[][] = [];
					const accumulator = createBatchAccumulator<number>(
						(items) => batches.push([...items]),
						INTERVAL,
						MAX_BATCH_SIZE
					);

					for (let i = 0; i < eventCount; i++) {
						accumulator.push(i);
					}

					// Advance enough time to flush all batches
					vi.advanceTimersByTime(INTERVAL * Math.ceil(eventCount / MAX_BATCH_SIZE));

					const totalProcessed = batches.reduce((sum, batch) => sum + batch.length, 0);
					expect(totalProcessed).toBe(eventCount);

					accumulator.cancel();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('events pushed within the same interval window end up in the same batch (unless exceeding max)', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 200 }),
				(eventCount) => {
					// Only test with counts <= maxBatchSize to verify single-window grouping
					const batches: number[][] = [];
					const accumulator = createBatchAccumulator<number>(
						(items) => batches.push([...items]),
						INTERVAL,
						MAX_BATCH_SIZE
					);

					// Push all events without advancing time (within same window)
					for (let i = 0; i < eventCount; i++) {
						accumulator.push(i);
					}

					// Advance time to trigger the flush
					vi.advanceTimersByTime(INTERVAL);

					// All events should be in a single batch since count <= maxBatchSize
					expect(batches.length).toBe(1);
					expect(batches[0].length).toBe(eventCount);

					accumulator.cancel();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('events exceeding maxBatchSize split into multiple batches correctly', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 201, max: 500 }),
				(eventCount) => {
					const batches: number[][] = [];
					const accumulator = createBatchAccumulator<number>(
						(items) => batches.push([...items]),
						INTERVAL,
						MAX_BATCH_SIZE
					);

					// Push all events rapidly
					for (let i = 0; i < eventCount; i++) {
						accumulator.push(i);
					}

					// Advance enough time to process all remaining batches
					vi.advanceTimersByTime(INTERVAL * Math.ceil(eventCount / MAX_BATCH_SIZE));

					// Verify no batch exceeds max
					for (const batch of batches) {
						expect(batch.length).toBeLessThanOrEqual(MAX_BATCH_SIZE);
					}

					// Verify all items are accounted for
					const totalProcessed = batches.reduce((sum, batch) => sum + batch.length, 0);
					expect(totalProcessed).toBe(eventCount);

					// Verify multiple batches were created
					expect(batches.length).toBeGreaterThan(1);

					accumulator.cancel();
				}
			),
			{ numRuns: 100 }
		);
	});
});
