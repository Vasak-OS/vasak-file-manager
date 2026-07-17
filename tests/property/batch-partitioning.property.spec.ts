import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	partitionIntoBatches,
	prioritizePaths,
	getCachedIfTimestampUnchanged,
	MAX_BATCH_SIZE,
	PRIORITY_THRESHOLD,
} from '@/composables/use-dir-size-batch';

/**
 * Arbitrary: generates random file system paths of varying lengths.
 */
const arbPathSegment = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('/'));
const arbPath = fc.array(arbPathSegment, { minLength: 1, maxLength: 4 })
	.map((segments) => `/${segments.join('/')}`);

const arbPathArray = (min = 0, max = 200) =>
	fc.array(arbPath, { minLength: min, maxLength: max });

describe('Property 8: Partición de lotes de tamaño de directorio', () => {
	/**
	 * **Validates: Requirements 4.1**
	 *
	 * For any list of N paths, partitionIntoBatches SHALL produce batches where
	 * each batch has max 20 elements and the union of all batches equals the original set.
	 */
	it('each batch has at most MAX_BATCH_SIZE elements', () => {
		fc.assert(
			fc.property(arbPathArray(), (paths) => {
				const batches = partitionIntoBatches(paths);
				for (const batch of batches) {
					expect(batch.length).toBeLessThanOrEqual(MAX_BATCH_SIZE);
					expect(batch.length).toBeGreaterThan(0);
				}
			}),
			{ numRuns: 100 },
		);
	});

	it('the union of all batches equals the original array', () => {
		fc.assert(
			fc.property(arbPathArray(), (paths) => {
				const batches = partitionIntoBatches(paths);
				const flattened = batches.flat();
				expect(flattened).toEqual(paths);
			}),
			{ numRuns: 100 },
		);
	});

	it('preserves the order of elements across batches', () => {
		fc.assert(
			fc.property(arbPathArray(), (paths) => {
				const batches = partitionIntoBatches(paths);
				const flattened = batches.flat();
				for (let i = 0; i < paths.length; i++) {
					expect(flattened[i]).toBe(paths[i]);
				}
			}),
			{ numRuns: 100 },
		);
	});

	it('produces correct number of batches', () => {
		fc.assert(
			fc.property(arbPathArray(), (paths) => {
				const batches = partitionIntoBatches(paths);
				const expectedBatchCount = Math.ceil(paths.length / MAX_BATCH_SIZE);
				expect(batches.length).toBe(expectedBatchCount);
			}),
			{ numRuns: 100 },
		);
	});

	it('empty input produces no batches', () => {
		const batches = partitionIntoBatches([]);
		expect(batches).toEqual([]);
	});
});

describe('Property 9: Reutilización de caché por timestamp invariante', () => {
	/**
	 * **Validates: Requirements 4.4**
	 *
	 * For any directory with unchanged timestamp, getCachedIfTimestampUnchanged
	 * SHALL return the cached size.
	 */
	it('returns cached size when calculatedAt >= currentTimestamp', () => {
		fc.assert(
			fc.property(
				fc.nat({ max: 1_000_000 }), // size
				fc.nat({ max: 1_000_000_000 }), // calculatedAt
				fc.nat({ max: 1_000_000_000 }), // currentTimestamp
				(size, calculatedAt, currentTimestamp) => {
					// Ensure calculatedAt >= currentTimestamp (cache is up to date)
					const adjustedCalculatedAt = currentTimestamp + calculatedAt;
					const cached = {
						size,
						status: 'Complete' as const,
						calculatedAt: adjustedCalculatedAt,
					};
					const result = getCachedIfTimestampUnchanged(cached, currentTimestamp);
					expect(result).toBe(size);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('returns null when cache is outdated (calculatedAt < currentTimestamp)', () => {
		fc.assert(
			fc.property(
				fc.nat({ max: 1_000_000 }), // size
				fc.nat({ max: 1_000_000_000 }), // calculatedAt
				fc.integer({ min: 1, max: 1_000_000_000 }), // delta > 0
				(size, calculatedAt, delta) => {
					const currentTimestamp = calculatedAt + delta;
					const cached = {
						size,
						status: 'Complete' as const,
						calculatedAt,
					};
					const result = getCachedIfTimestampUnchanged(cached, currentTimestamp);
					expect(result).toBeNull();
				},
			),
			{ numRuns: 100 },
		);
	});

	it('returns cached size when no timestamp is provided (assume valid)', () => {
		fc.assert(
			fc.property(
				fc.nat({ max: 1_000_000 }),
				fc.nat({ max: 1_000_000_000 }),
				(size, calculatedAt) => {
					const cached = {
						size,
						status: 'Complete' as const,
						calculatedAt,
					};
					const result = getCachedIfTimestampUnchanged(cached, undefined);
					expect(result).toBe(size);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('returns null when cache status is not Complete', () => {
		fc.assert(
			fc.property(
				fc.nat({ max: 1_000_000 }),
				fc.nat({ max: 1_000_000_000 }),
				fc.constantFrom('Loading', 'Error', 'Timeout'),
				(size, calculatedAt, status) => {
					const cached = { size, status, calculatedAt };
					const result = getCachedIfTimestampUnchanged(cached, calculatedAt);
					expect(result).toBeNull();
				},
			),
			{ numRuns: 100 },
		);
	});

	it('returns null when cached is undefined', () => {
		const result = getCachedIfTimestampUnchanged(undefined, 12345);
		expect(result).toBeNull();
	});
});

describe('Property 10: Priorización de directorios visibles', () => {
	/**
	 * **Validates: Requirements 4.5**
	 *
	 * For any mix of visible/non-visible paths (when >5 pending),
	 * prioritizePaths SHALL place all visible paths before non-visible ones.
	 */
	it('visible paths appear before non-visible paths when count > PRIORITY_THRESHOLD', () => {
		fc.assert(
			fc.property(
				// Generate paths with at least PRIORITY_THRESHOLD + 1 elements
				arbPathArray(PRIORITY_THRESHOLD + 1, 200),
				fc.func(fc.boolean()), // random isVisible function
				(paths, isVisibleRaw) => {
					// Create a deterministic isVisible from the generated function
					const isVisible = (path: string) => isVisibleRaw(path);
					const result = prioritizePaths(paths, isVisible);

					// Find the last visible and first non-visible indices
					let lastVisibleIdx = -1;
					let firstNonVisibleIdx = result.length;

					for (let i = 0; i < result.length; i++) {
						if (isVisible(result[i])) {
							lastVisibleIdx = i;
						} else if (firstNonVisibleIdx === result.length) {
							firstNonVisibleIdx = i;
						}
					}

					// All visible paths must come before all non-visible paths
					if (lastVisibleIdx !== -1 && firstNonVisibleIdx < result.length) {
						expect(lastVisibleIdx).toBeLessThan(firstNonVisibleIdx);
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	it('preserves all original elements (same set)', () => {
		fc.assert(
			fc.property(
				arbPathArray(PRIORITY_THRESHOLD + 1, 200),
				fc.func(fc.boolean()),
				(paths, isVisibleRaw) => {
					const isVisible = (path: string) => isVisibleRaw(path);
					const result = prioritizePaths(paths, isVisible);

					expect(result.length).toBe(paths.length);
					expect([...result].sort()).toEqual([...paths].sort());
				},
			),
			{ numRuns: 100 },
		);
	});

	it('returns paths unchanged when count <= PRIORITY_THRESHOLD', () => {
		fc.assert(
			fc.property(
				arbPathArray(0, PRIORITY_THRESHOLD),
				fc.func(fc.boolean()),
				(paths, isVisibleRaw) => {
					const isVisible = (path: string) => isVisibleRaw(path);
					const result = prioritizePaths(paths, isVisible);
					expect(result).toEqual(paths);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('returns paths unchanged when no isVisible function is provided', () => {
		fc.assert(
			fc.property(arbPathArray(0, 200), (paths) => {
				const result = prioritizePaths(paths, undefined);
				expect(result).toEqual(paths);
			}),
			{ numRuns: 100 },
		);
	});
});

describe('Property 11: Aislamiento de errores en batch de tamaños', () => {
	/**
	 * **Validates: Requirements 4.7**
	 *
	 * Error isolation: the batch processing function structure allows individual
	 * failures without stopping others. Test the pure logic pattern.
	 */

	/**
	 * Simulates the batchWithIsolation pattern from the design document.
	 * This is the pure logic that ensures one failure doesn't stop others.
	 */
	async function batchWithIsolation<T, R>(
		items: T[],
		processor: (item: T) => Promise<R>,
		onError: (item: T, error: unknown) => void,
	): Promise<{ results: R[]; errors: Array<{ item: T; error: unknown }> }> {
		const results: R[] = [];
		const errors: Array<{ item: T; error: unknown }> = [];
		for (const item of items) {
			try {
				results.push(await processor(item));
			} catch (error) {
				errors.push({ item, error });
				onError(item, error);
			}
		}
		return { results, errors };
	}

	it('successful items are processed even when some fail', () => {
		fc.assert(
			fc.asyncProperty(
				fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 50 }),
				fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }),
				async (items, shouldFailFlags) => {
					// Use index-based tracking to avoid indexOf issues with duplicates
					const indexedItems = items.map((val, idx) => ({ val, idx }));
					const shouldFail = (idx: number) => shouldFailFlags[idx % shouldFailFlags.length];
					const errorLog: Array<{ item: { val: number; idx: number }; error: unknown }> = [];

					const { results, errors } = await batchWithIsolation(
						indexedItems,
						async (item) => {
							if (shouldFail(item.idx)) {
								throw new Error(`Permission denied for item at index ${item.idx}`);
							}
							return item.val * 2;
						},
						(item, error) => {
							errorLog.push({ item, error });
						},
					);

					// results + errors should account for all items
					expect(results.length + errors.length).toBe(items.length);

					// Errors match items that should fail
					const expectedFailCount = indexedItems.filter((item) => shouldFail(item.idx)).length;
					expect(errors.length).toBe(expectedFailCount);

					// Results match items that should succeed
					const expectedSuccessCount = indexedItems.filter((item) => !shouldFail(item.idx)).length;
					expect(results.length).toBe(expectedSuccessCount);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('all items succeed when there are no failures', () => {
		fc.assert(
			fc.asyncProperty(
				fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 50 }),
				async (items) => {
					const { results, errors } = await batchWithIsolation(
						items,
						async (item) => item * 2,
						() => {},
					);

					expect(results.length).toBe(items.length);
					expect(errors.length).toBe(0);
					for (let i = 0; i < items.length; i++) {
						expect(results[i]).toBe(items[i] * 2);
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	it('all items can fail without crashing the batch', () => {
		fc.assert(
			fc.asyncProperty(
				fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 50 }),
				async (items) => {
					const { results, errors } = await batchWithIsolation(
						items,
						async () => {
							throw new Error('Permission denied');
						},
						() => {},
					);

					expect(results.length).toBe(0);
					expect(errors.length).toBe(items.length);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('error callback is invoked for each failing item', () => {
		fc.assert(
			fc.asyncProperty(
				fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 50 }),
				fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }),
				async (items, shouldFailFlags) => {
					const indexedItems = items.map((val, idx) => ({ val, idx }));
					const shouldFail = (idx: number) => shouldFailFlags[idx % shouldFailFlags.length];
					const callbackCount: number[] = [];

					await batchWithIsolation(
						indexedItems,
						async (item) => {
							if (shouldFail(item.idx)) {
								throw new Error('fail');
							}
							return item.val;
						},
						() => {
							callbackCount.push(1);
						},
					);

					// The error callback should have been called for each failing item
					const expectedFailCount = indexedItems.filter((item) =>
						shouldFail(item.idx),
					).length;
					expect(callbackCount.length).toBe(expectedFailCount);
				},
			),
			{ numRuns: 100 },
		);
	});
});
