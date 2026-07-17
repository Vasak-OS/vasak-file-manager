import { describe, it, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import fc from 'fast-check';
import { useDirectoryCacheStore } from '@/stores/runtime/directory-cache';
import { computeDiff, applyDiff } from '@/utils/directory-diff';
import type { DirEntry, DirContents } from '@/types/dir-entry';

/**
 * Property-based tests for Directory Cache store and diff utilities.
 *
 * Feature: performance-and-features
 */
describe('Property Tests: Directory Cache', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	/**
	 * Arbitrary generator for a DirEntry with a given path.
	 */
	const dirEntryArb = (pathArb?: fc.Arbitrary<string>): fc.Arbitrary<DirEntry> =>
		fc.record({
			name: fc.string({ minLength: 1, maxLength: 30 }),
			ext: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: null }),
			path: pathArb ?? fc.string({ minLength: 1, maxLength: 100 }),
			size: fc.nat({ max: 1_000_000_000 }),
			item_count: fc.option(fc.nat({ max: 10000 }), { nil: null }),
			modified_time: fc.nat({ max: 2_000_000_000 }),
			accessed_time: fc.nat({ max: 2_000_000_000 }),
			created_time: fc.nat({ max: 2_000_000_000 }),
			mime: fc.option(fc.constantFrom('text/plain', 'image/png', 'application/pdf'), {
				nil: null,
			}),
			is_file: fc.boolean(),
			is_dir: fc.boolean(),
			is_symlink: fc.constant(false),
			is_hidden: fc.boolean(),
		});

	/**
	 * Generator for DirEntry with unique paths from a given pool of path strings.
	 */
	const uniqueDirEntriesArb = (
		minLength: number,
		maxLength: number,
	): fc.Arbitrary<DirEntry[]> =>
		fc
			.uniqueArray(fc.string({ minLength: 1, maxLength: 60 }), {
				minLength,
				maxLength,
			})
			.chain((paths) => fc.tuple(...paths.map((p) => dirEntryArb(fc.constant(p)))))
			.map((entries) => entries as DirEntry[]);

	/**
	 * Generator for DirContents for use with the cache store.
	 */
	const dirContentsArb = (dirPath: string): fc.Arbitrary<DirContents> =>
		fc.array(dirEntryArb(), { minLength: 0, maxLength: 20 }).map((entries) => ({
			path: dirPath,
			entries,
			total_count: entries.length,
			dir_count: entries.filter((e) => e.is_dir).length,
			file_count: entries.filter((e) => e.is_file).length,
		}));

	/**
	 * Property 6: Invariante LRU del Directory Cache
	 *
	 * For any sequence of set operations on the Directory Cache,
	 * the number of cached directories SHALL never exceed 50,
	 * and the evicted entry SHALL be the least recently accessed.
	 *
	 * **Validates: Requirements 3.4**
	 */
	describe('Property 6: Invariante LRU del Directory Cache', () => {
		it('cache size never exceeds 50 entries for any sequence of set operations', () => {
			fc.assert(
				fc.property(
					// Generate a sequence of unique directory paths (up to 80 to test overflow)
					fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
						minLength: 1,
						maxLength: 80,
					}),
					(paths) => {
						const store = useDirectoryCacheStore();

						for (const path of paths) {
							const contents: DirContents = {
								path,
								entries: [],
								total_count: 0,
								dir_count: 0,
								file_count: 0,
							};
							store.set(path, contents);

							// Invariant: cache size never exceeds 50
							if (store.cache.size > 50) {
								return false;
							}
						}

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('evicted entry is always the least recently accessed', () => {
			fc.assert(
				fc.property(
					// Indices of entries to access (promote in LRU) before adding more
					fc.array(fc.integer({ min: 0, max: 49 }), {
						minLength: 1,
						maxLength: 10,
					}),
					(accessIndices) => {
						const store = useDirectoryCacheStore();

						// Fill cache to capacity with 50 unique paths
						const paths: string[] = [];
						for (let i = 0; i < 50; i++) {
							const path = `/dir/path_${i}`;
							paths.push(path);
							store.set(path, {
								path,
								entries: [],
								total_count: 0,
								dir_count: 0,
								file_count: 0,
							});
						}

						// Access specific entries to promote them in LRU order
						for (const idx of accessIndices) {
							store.get(paths[idx]);
						}

						// Determine which entry should be evicted (least recently accessed)
						// The LRU is the first path in accessOrder — which is the oldest not-promoted one
						const promotedSet = new Set(accessIndices);
						let expectedEviction: string | null = null;
						for (let i = 0; i < paths.length; i++) {
							if (!promotedSet.has(i)) {
								expectedEviction = paths[i];
								break;
							}
						}

						// Add a new entry to trigger eviction
						const newPath = '/__trigger_eviction__';
						store.set(newPath, {
							path: newPath,
							entries: [],
							total_count: 0,
							dir_count: 0,
							file_count: 0,
						});

						// Cache size should still be 50
						if (store.cache.size > 50) return false;

						// The expected evicted entry should no longer be cached
						if (expectedEviction !== null) {
							return !store.has(expectedEviction);
						}

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('random sequence of get/set/invalidate never exceeds capacity', () => {
			const operationArb = fc.record({
				type: fc.constantFrom('set', 'get', 'invalidate'),
				pathIdx: fc.integer({ min: 0, max: 199 }),
			});

			fc.assert(
				fc.property(
					fc.array(operationArb, { minLength: 1, maxLength: 500 }),
					(operations) => {
						const store = useDirectoryCacheStore();

						for (const op of operations) {
							const path = `/dir_${op.pathIdx}`;

							switch (op.type) {
								case 'set':
									store.set(path, {
										path,
										entries: [],
										total_count: 0,
										dir_count: 0,
										file_count: 0,
									});
									break;
								case 'get':
									store.get(path);
									break;
								case 'invalidate':
									store.invalidate(path);
									break;
							}

							// Invariant: size NEVER exceeds 50
							if (store.cache.size > 50) {
								return false;
							}
						}

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});
	});

	/**
	 * Property 7: Corrección del diff de directorio
	 *
	 * For any pair of directory listings (old and new), computing the diff
	 * and applying it to the old list SHALL produce exactly the new list
	 * (by path set equality).
	 *
	 * **Validates: Requirements 3.6, 5.4**
	 */
	describe('Property 7: Corrección del diff de directorio', () => {
		it('applyDiff(old, computeDiff(old, new)) produces same path set as new', () => {
			fc.assert(
				fc.property(
					uniqueDirEntriesArb(0, 30),
					uniqueDirEntriesArb(0, 30),
					(oldEntries, newEntries) => {
						const diff = computeDiff(oldEntries, newEntries);
						const result = applyDiff(oldEntries, diff);

						// Extract path sets
						const resultPaths = new Set(result.map((e) => e.path));
						const newPaths = new Set(newEntries.map((e) => e.path));

						// Path set equality
						if (resultPaths.size !== newPaths.size) return false;
						for (const p of newPaths) {
							if (!resultPaths.has(p)) return false;
						}
						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('applyDiff(old, computeDiff(old, new)) produces entries with matching metadata', () => {
			fc.assert(
				fc.property(
					uniqueDirEntriesArb(0, 20),
					uniqueDirEntriesArb(0, 20),
					(oldEntries, newEntries) => {
						const diff = computeDiff(oldEntries, newEntries);
						const result = applyDiff(oldEntries, diff);

						// Build a map of new entries by path for comparison
						const newMap = new Map(newEntries.map((e) => [e.path, e]));

						// Every result entry should match the corresponding new entry's metadata
						for (const entry of result) {
							const expected = newMap.get(entry.path);
							if (!expected) return false;
							if (entry.size !== expected.size) return false;
							if (entry.modified_time !== expected.modified_time) return false;
							if (entry.name !== expected.name) return false;
						}
						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('computeDiff with identical lists produces empty diff', () => {
			fc.assert(
				fc.property(uniqueDirEntriesArb(0, 30), (entries) => {
					const diff = computeDiff(entries, entries);
					return (
						diff.added.length === 0 &&
						diff.removed.length === 0 &&
						diff.updated.length === 0
					);
				}),
				{ numRuns: 100 },
			);
		});

		it('computeDiff with empty old list marks all new as added', () => {
			fc.assert(
				fc.property(uniqueDirEntriesArb(1, 20), (newEntries) => {
					const diff = computeDiff([], newEntries);
					return (
						diff.added.length === newEntries.length &&
						diff.removed.length === 0 &&
						diff.updated.length === 0
					);
				}),
				{ numRuns: 100 },
			);
		});

		it('computeDiff with empty new list marks all old as removed', () => {
			fc.assert(
				fc.property(uniqueDirEntriesArb(1, 20), (oldEntries) => {
					const diff = computeDiff(oldEntries, []);
					return (
						diff.removed.length === oldEntries.length &&
						diff.added.length === 0 &&
						diff.updated.length === 0
					);
				}),
				{ numRuns: 100 },
			);
		});
	});
});
