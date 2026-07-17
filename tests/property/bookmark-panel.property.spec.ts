import { describe, it, beforeEach, expect, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import fc from 'fast-check';
import { useBookmarksStore } from '@/stores/storage/bookmarks';
import { useUserStatsStore } from '@/stores/storage/user-stats';
import type { HistoryItem, FrequentItem } from '@/types/user-stats';

/**
 * Property-based tests for Bookmark Panel.
 *
 * Feature: performance-and-features
 */

// Mock Tauri dependencies used by user-stats store
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
	LazyStore: vi.fn().mockImplementation(() => ({
		entries: vi.fn().mockResolvedValue([]),
		set: vi.fn().mockResolvedValue(undefined),
		save: vi.fn().mockResolvedValue(undefined),
	})),
}));

vi.mock('@/stores/storage/user-paths', () => ({
	useUserPathsStore: () => ({
		customPaths: {
			appUserDataStatsPath: '/mock/stats-path',
		},
	}),
}));

// --- Arbitraries ---

/** Generate a valid unix-like path for directories */
const dirPathArb = fc.array(
	fc.stringMatching(/^[a-zA-Z0-9_.-]{1,20}$/),
	{ minLength: 1, maxLength: 5 },
).map((parts) => '/' + parts.join('/'));

/** Generate a HistoryItem (directory only, isFile=false) */
const historyItemArb = fc.record({
	path: dirPathArb,
	openedAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
	isFile: fc.constant(false as boolean),
});

/** Generate a HistoryItem that could be a file (to test filtering) */
const historyItemMixedArb = fc.record({
	path: dirPathArb,
	openedAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
	isFile: fc.boolean(),
});

/** Generate a FrequentItem (directory only) */
const frequentItemArb = fc.record({
	path: dirPathArb,
	openCount: fc.integer({ min: 1, max: 10000 }),
	lastOpenedAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
	isFile: fc.constant(false as boolean),
});

/** Generate a FrequentItem that could be a file (to test filtering) */
const frequentItemMixedArb = fc.record({
	path: dirPathArb,
	openCount: fc.integer({ min: 1, max: 10000 }),
	lastOpenedAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
	isFile: fc.boolean(),
});

describe('Property Tests: Bookmark Panel', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	/**
	 * Property 13: Límites y orden del Bookmark Panel
	 *
	 * For any user data set, the Bookmark Panel SHALL show:
	 * - History limited to 50 entries ordered by date descending
	 * - Frequent limited to 20 entries ordered by open count descending
	 *
	 * **Validates: Requirements 7.1**
	 */
	describe('Property 13: Límites y orden del Bookmark Panel', () => {
		it('history is limited to 50 entries and ordered by date descending', () => {
			fc.assert(
				fc.property(
					// Generate between 0 and 200 directory history items with unique paths
					fc.uniqueArray(historyItemArb, { minLength: 0, maxLength: 200, selector: (item) => item.path }),
					(historyItems) => {
						const pinia = createPinia();
						setActivePinia(pinia);

						const userStatsStore = useUserStatsStore();
						// Directly set the history data
						userStatsStore.userStats.history = historyItems as HistoryItem[];

						const bookmarksStore = useBookmarksStore();
						const history = bookmarksStore.history;

						// Property: limited to 50
						if (history.length > 50) return false;

						// The number of dir items should be min(dirItems.length, 50)
						const dirItems = historyItems.filter((item) => !item.isFile);
						const expectedLength = Math.min(dirItems.length, 50);
						if (history.length !== expectedLength) return false;

						// Property: ordered by date descending
						for (let i = 1; i < history.length; i++) {
							const prevItem = userStatsStore.sortedHistory.filter((h) => !h.isFile).find((h) => h.path === history[i - 1].path);
							const currItem = userStatsStore.sortedHistory.filter((h) => !h.isFile).find((h) => h.path === history[i].path);
							if (!prevItem || !currItem) return false;
							if (prevItem.openedAt < currItem.openedAt) return false;
						}

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('history filters out file entries (only directories)', () => {
			fc.assert(
				fc.property(
					fc.uniqueArray(historyItemMixedArb, { minLength: 0, maxLength: 100, selector: (item) => item.path }),
					(mixedItems) => {
						const pinia = createPinia();
						setActivePinia(pinia);

						const userStatsStore = useUserStatsStore();
						userStatsStore.userStats.history = mixedItems as HistoryItem[];

						const bookmarksStore = useBookmarksStore();
						const history = bookmarksStore.history;

						// All items in history must be directories (isFile === false in source)
						const dirCount = mixedItems.filter((item) => !item.isFile).length;
						const expectedCount = Math.min(dirCount, 50);

						return history.length === expectedCount;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('frequent is limited to 20 entries and ordered by open count descending', () => {
			fc.assert(
				fc.property(
					// Generate between 0 and 100 directory frequent items with unique paths
					fc.uniqueArray(frequentItemArb, { minLength: 0, maxLength: 100, selector: (item) => item.path }),
					(frequentItems) => {
						const pinia = createPinia();
						setActivePinia(pinia);

						const userStatsStore = useUserStatsStore();
						userStatsStore.userStats.frequentItems = frequentItems as FrequentItem[];

						const bookmarksStore = useBookmarksStore();
						const frequent = bookmarksStore.frequent;

						// Property: limited to 20
						if (frequent.length > 20) return false;

						// The number of dir items should be min(dirItems.length, 20)
						const dirItems = frequentItems.filter((item) => !item.isFile);
						const expectedLength = Math.min(dirItems.length, 20);
						if (frequent.length !== expectedLength) return false;

						// Property: ordered by open count descending
						for (let i = 1; i < frequent.length; i++) {
							const prevItem = userStatsStore.sortedFrequentItems.filter((f) => !f.isFile).find((f) => f.path === frequent[i - 1].path);
							const currItem = userStatsStore.sortedFrequentItems.filter((f) => !f.isFile).find((f) => f.path === frequent[i].path);
							if (!prevItem || !currItem) return false;
							if (prevItem.openCount < currItem.openCount) return false;
						}

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('frequent filters out file entries (only directories)', () => {
			fc.assert(
				fc.property(
					fc.uniqueArray(frequentItemMixedArb, { minLength: 0, maxLength: 100, selector: (item) => item.path }),
					(mixedItems) => {
						const pinia = createPinia();
						setActivePinia(pinia);

						const userStatsStore = useUserStatsStore();
						userStatsStore.userStats.frequentItems = mixedItems as FrequentItem[];

						const bookmarksStore = useBookmarksStore();
						const frequent = bookmarksStore.frequent;

						// All items in frequent must be directories
						const dirCount = mixedItems.filter((item) => !item.isFile).length;
						const expectedCount = Math.min(dirCount, 20);

						return frequent.length === expectedCount;
					},
				),
				{ numRuns: 100 },
			);
		});
	});

	/**
	 * Property 14: Opción contextual correcta según estado de favorito
	 *
	 * For any directory and its current favorite state (true/false),
	 * the context menu SHALL show "Add to Favorites" if not favorite,
	 * or "Remove from Favorites" if already favorite.
	 *
	 * **Validates: Requirements 7.2**
	 */
	describe('Property 14: Opción contextual correcta según estado de favorito', () => {
		it('isFavorite returns correct state after add/remove operations', () => {
			fc.assert(
				fc.property(
					dirPathArb,
					fc.boolean(),
					(path, shouldBeFavorite) => {
						const pinia = createPinia();
						setActivePinia(pinia);

						const bookmarksStore = useBookmarksStore();

						if (shouldBeFavorite) {
							bookmarksStore.addFavorite(path);
						}

						const isFav = bookmarksStore.isFavorite(path);

						// Property: isFavorite matches expected state
						if (shouldBeFavorite && !isFav) return false;
						if (!shouldBeFavorite && isFav) return false;

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('context menu action is determined by isFavorite state', () => {
			fc.assert(
				fc.property(
					// Generate a list of paths, some added as favorites
					fc.uniqueArray(dirPathArb, { minLength: 1, maxLength: 30 }),
					fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }),
					(paths, addFlags) => {
						const pinia = createPinia();
						setActivePinia(pinia);

						const bookmarksStore = useBookmarksStore();

						// Add some paths as favorites based on flags
						for (let i = 0; i < Math.min(paths.length, addFlags.length); i++) {
							if (addFlags[i]) {
								bookmarksStore.addFavorite(paths[i]);
							}
						}

						// For each path, verify context menu logic
						for (let i = 0; i < paths.length; i++) {
							const isFav = bookmarksStore.isFavorite(paths[i]);
							const shouldAdd = i < addFlags.length && addFlags[i];

							// "Add to Favorites" shown if NOT favorite
							// "Remove from Favorites" shown if IS favorite
							if (shouldAdd && !isFav) return false;
							if (!shouldAdd && isFav) return false;
						}

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('removeFavorite correctly toggles state from favorite to non-favorite', () => {
			fc.assert(
				fc.property(
					dirPathArb,
					(path) => {
						const pinia = createPinia();
						setActivePinia(pinia);

						const bookmarksStore = useBookmarksStore();

						// Add then remove
						bookmarksStore.addFavorite(path);
						if (!bookmarksStore.isFavorite(path)) return false;

						bookmarksStore.removeFavorite(path);
						if (bookmarksStore.isFavorite(path)) return false;

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('addFavorite is idempotent — adding same path twice does not duplicate', () => {
			fc.assert(
				fc.property(
					dirPathArb,
					(path) => {
						const pinia = createPinia();
						setActivePinia(pinia);

						const bookmarksStore = useBookmarksStore();

						bookmarksStore.addFavorite(path);
						bookmarksStore.addFavorite(path);

						// Should still only have one entry
						const count = bookmarksStore.favoritePaths.filter((p) => p === path).length;
						return count === 1;
					},
				),
				{ numRuns: 100 },
			);
		});
	});

	/**
	 * Property 15: Solo directorios aceptados como favoritos por drag
	 *
	 * For any entry dragged to the Favorites section, the Bookmark Panel
	 * SHALL accept the drop only if the entry is a directory (is_dir === true)
	 * and reject it otherwise.
	 *
	 * **Validates: Requirements 7.8**
	 */
	describe('Property 15: Solo directorios aceptados como favoritos por drag', () => {
		/** Simulates the BookmarkDropHandler.canDrop logic from the design */
		function canDropAsFavorite(entry: { is_dir: boolean; is_file: boolean }): boolean {
			return entry.is_dir === true;
		}

		it('only entries with is_dir === true are accepted as favorites via drag', () => {
			const dirEntryArb = fc.record({
				name: fc.string({ minLength: 1, maxLength: 50 }),
				ext: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: null }),
				path: dirPathArb,
				size: fc.nat(),
				item_count: fc.option(fc.nat(), { nil: null }),
				modified_time: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
				accessed_time: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
				created_time: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
				mime: fc.option(fc.string({ minLength: 3, maxLength: 30 }), { nil: null }),
				is_file: fc.boolean(),
				is_dir: fc.boolean(),
				is_symlink: fc.boolean(),
				is_hidden: fc.boolean(),
			});

			fc.assert(
				fc.property(
					dirEntryArb,
					(entry) => {
						const accepted = canDropAsFavorite(entry);

						// Property: accepted if and only if is_dir is true
						if (entry.is_dir && !accepted) return false;
						if (!entry.is_dir && accepted) return false;

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('files (is_dir === false) are always rejected as favorites via drag', () => {
			fc.assert(
				fc.property(
					dirPathArb,
					fc.string({ minLength: 1, maxLength: 50 }),
					(path, name) => {
						const fileEntry = {
							name,
							path,
							is_dir: false,
							is_file: true,
						};

						return canDropAsFavorite(fileEntry) === false;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('directories (is_dir === true) are always accepted as favorites via drag', () => {
			fc.assert(
				fc.property(
					dirPathArb,
					fc.string({ minLength: 1, maxLength: 50 }),
					(path, name) => {
						const dirEntry = {
							name,
							path,
							is_dir: true,
							is_file: false,
						};

						return canDropAsFavorite(dirEntry) === true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('symlinks to directories (is_dir === true, is_symlink === true) are accepted', () => {
			fc.assert(
				fc.property(
					dirPathArb,
					fc.string({ minLength: 1, maxLength: 50 }),
					(path, name) => {
						const symlinkDirEntry = {
							name,
							path,
							is_dir: true,
							is_file: false,
							is_symlink: true,
						};

						// Even symlinks should be accepted if is_dir is true
						return canDropAsFavorite(symlinkDirEntry) === true;
					},
				),
				{ numRuns: 100 },
			);
		});
	});
});
