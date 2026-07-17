import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	limitSearchResults,
	getDriveRoot,
	groupResultsByDriveRoot,
} from '@/utils/search-results';
import { SEARCH_CONSTANTS } from '@/constants/search';
import type { DirEntry } from '@/types/dir-entry';

/**
 * Arbitrary: generates a random Unix mount-point root from common prefixes.
 */
const arbMountRoot = fc.constantFrom(
	'/home',
	'/mnt',
	'/media',
	'/opt',
	'/var',
	'/tmp',
	'/usr',
	'/srv',
	'/data',
	'/run',
);

/**
 * Arbitrary: generates a random path segment (filename or directory name).
 */
const arbPathSegment = fc
	.string({ minLength: 1, maxLength: 12 })
	.filter((s) => !s.includes('/') && !s.includes('\0') && s.trim().length > 0);

/**
 * Arbitrary: generates a random Unix file path rooted at a known mount point.
 * Produces paths like `/home/user/docs/file.txt`, `/mnt/backup/archive`.
 */
const arbUnixPath = fc
	.tuple(
		arbMountRoot,
		fc.array(arbPathSegment, { minLength: 1, maxLength: 4 }),
	)
	.map(([root, segments]) => `${root}/${segments.join('/')}`);

/**
 * Arbitrary: generates a minimal DirEntry with a given path.
 */
function arbDirEntryWithPath(pathArb: fc.Arbitrary<string>): fc.Arbitrary<DirEntry> {
	return pathArb.map((path) => ({
		name: path.split('/').pop() || 'unknown',
		ext: null,
		path,
		size: 0,
		item_count: null,
		modified_time: 0,
		accessed_time: 0,
		created_time: 0,
		mime: null,
		is_file: true,
		is_dir: false,
		is_symlink: false,
		is_hidden: false,
	}));
}

/**
 * Arbitrary: generates an array of DirEntry items with random Unix paths.
 */
const arbDirEntryArray = (min = 0, max = 600) =>
	fc.array(arbDirEntryWithPath(arbUnixPath), { minLength: min, maxLength: max });

describe('Property 18: Límite de resultados de búsqueda', () => {
	/**
	 * **Validates: Requirements 9.2**
	 *
	 * For any query returning N results from backend, the number of visible
	 * results SHALL be ≤ 500.
	 */
	it('visible results are always ≤ MAX_RESULT_LIMIT (500)', () => {
		fc.assert(
			fc.property(arbDirEntryArray(0, 600), (results) => {
				const limited = limitSearchResults(results);
				expect(limited.length).toBeLessThanOrEqual(SEARCH_CONSTANTS.MAX_RESULT_LIMIT);
			}),
			{ numRuns: 100 },
		);
	});

	it('when N ≤ 500, all results are preserved', () => {
		fc.assert(
			fc.property(arbDirEntryArray(0, 500), (results) => {
				// Only test arrays within the limit
				if (results.length <= SEARCH_CONSTANTS.MAX_RESULT_LIMIT) {
					const limited = limitSearchResults(results);
					expect(limited.length).toBe(results.length);
					expect(limited).toEqual(results);
				}
			}),
			{ numRuns: 100 },
		);
	});

	it('when N > 500, exactly 500 results are returned', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 501, max: 1000 }),
				(count) => {
					const results: DirEntry[] = Array.from({ length: count }, (_, i) => ({
						name: `file${i}.txt`,
						ext: 'txt',
						path: `/home/user/file${i}.txt`,
						size: i * 100,
						item_count: null,
						modified_time: Date.now(),
						accessed_time: Date.now(),
						created_time: Date.now(),
						mime: 'text/plain',
						is_file: true,
						is_dir: false,
						is_symlink: false,
						is_hidden: false,
					}));

					const limited = limitSearchResults(results);
					expect(limited.length).toBe(SEARCH_CONSTANTS.MAX_RESULT_LIMIT);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('order of results is preserved after limiting', () => {
		fc.assert(
			fc.property(arbDirEntryArray(0, 600), (results) => {
				const limited = limitSearchResults(results);
				for (let i = 0; i < limited.length; i++) {
					expect(limited[i]).toBe(results[i]);
				}
			}),
			{ numRuns: 100 },
		);
	});
});

describe('Property 19: Agrupación de resultados por raíz de disco', () => {
	/**
	 * **Validates: Requirements 9.3**
	 *
	 * For any set of results with paths on multiple mount points, the grouping
	 * function SHALL produce groups where each result is assigned to its correct
	 * root, and the union of all groups equals the original set.
	 */
	it('each result is assigned to the group matching its drive root', () => {
		fc.assert(
			fc.property(arbDirEntryArray(1, 200), (results) => {
				const groups = groupResultsByDriveRoot(results);

				for (const group of groups) {
					for (const entry of group.entries) {
						const expectedRoot = getDriveRoot(entry.path);
						expect(group.driveRoot).toBe(expectedRoot);
					}
				}
			}),
			{ numRuns: 100 },
		);
	});

	it('the union of all groups equals the original set', () => {
		fc.assert(
			fc.property(arbDirEntryArray(1, 200), (results) => {
				const groups = groupResultsByDriveRoot(results);
				const allEntries = groups.flatMap((g) => g.entries);

				// Same count
				expect(allEntries.length).toBe(results.length);

				// Same paths (as a multiset — order within groups may differ from input)
				const originalPaths = results.map((e) => e.path).sort();
				const groupedPaths = allEntries.map((e) => e.path).sort();
				expect(groupedPaths).toEqual(originalPaths);
			}),
			{ numRuns: 100 },
		);
	});

	it('no result appears in more than one group', () => {
		fc.assert(
			fc.property(arbDirEntryArray(1, 200), (results) => {
				const groups = groupResultsByDriveRoot(results);
				const seenPaths: string[] = [];

				for (const group of groups) {
					for (const entry of group.entries) {
						// Track the entry reference identity by index in original
						seenPaths.push(entry.path);
					}
				}

				// Total number of entries across groups matches input
				expect(seenPaths.length).toBe(results.length);
			}),
			{ numRuns: 100 },
		);
	});

	it('all groups have distinct drive roots', () => {
		fc.assert(
			fc.property(arbDirEntryArray(0, 200), (results) => {
				const groups = groupResultsByDriveRoot(results);
				const roots = groups.map((g) => g.driveRoot);
				const uniqueRoots = new Set(roots);
				expect(uniqueRoots.size).toBe(roots.length);
			}),
			{ numRuns: 100 },
		);
	});

	it('getDriveRoot correctly identifies mount points from random paths', () => {
		fc.assert(
			fc.property(arbUnixPath, (path) => {
				const root = getDriveRoot(path);
				// The path should start with the root
				expect(path.startsWith(root)).toBe(true);
				// The root should be a top-level mount point (e.g. /home, /mnt, /media)
				expect(root.startsWith('/')).toBe(true);
				// Root should not have trailing segments beyond the first directory
				const rootParts = root.split('/').filter(Boolean);
				expect(rootParts.length).toBeLessThanOrEqual(1);
			}),
			{ numRuns: 100 },
		);
	});

	it('empty input produces no groups', () => {
		const groups = groupResultsByDriveRoot([]);
		expect(groups).toEqual([]);
	});

	it('results from a single mount point produce exactly one group', () => {
		fc.assert(
			fc.property(
				arbMountRoot,
				fc.array(arbPathSegment, { minLength: 1, maxLength: 4 }),
				fc.integer({ min: 1, max: 20 }),
				(root, segments, count) => {
					const results: DirEntry[] = Array.from({ length: count }, (_, i) => ({
						name: `file${i}`,
						ext: null,
						path: `${root}/${segments.join('/')}/${i}`,
						size: 0,
						item_count: null,
						modified_time: 0,
						accessed_time: 0,
						created_time: 0,
						mime: null,
						is_file: true,
						is_dir: false,
						is_symlink: false,
						is_hidden: false,
					}));

					const groups = groupResultsByDriveRoot(results);
					expect(groups.length).toBe(1);
					expect(groups[0].driveRoot).toBe(root);
					expect(groups[0].entries.length).toBe(count);
				},
			),
			{ numRuns: 100 },
		);
	});
});
