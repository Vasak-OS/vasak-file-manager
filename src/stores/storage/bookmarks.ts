import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useUserStatsStore } from './user-stats';

const HISTORY_LIMIT = 50;
const FREQUENT_LIMIT = 20;
const STORAGE_KEY = 'vasak-bookmarks-favorites';

export interface BookmarkEntry {
	path: string;
	name: string;
	exists: boolean;
}

function loadFavoritesFromStorage(): string[] {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			if (Array.isArray(parsed)) {
				return parsed;
			}
		}
	} catch (error) {
		console.error('Failed to load bookmarks favorites from storage:', error);
	}
	return [];
}

function extractName(path: string): string {
	if (!path) return '';
	// Remove trailing slashes
	let cleaned = path;
	while (cleaned.length > 1 && cleaned.endsWith('/')) {
		cleaned = cleaned.slice(0, -1);
	}
	const lastSlash = cleaned.lastIndexOf('/');
	if (lastSlash === -1) return cleaned;
	return cleaned.slice(lastSlash + 1) || path;
}

export const useBookmarksStore = defineStore('bookmarks', () => {
	const userStatsStore = useUserStatsStore();

	/** Ordered array of favorite paths — persisted to localStorage */
	const favoritePaths = ref<string[]>(loadFavoritesFromStorage());

	/** Set of paths that have been verified as non-existent */
	const nonExistentPaths = ref<Set<string>>(new Set());

	// --- Computed: Favorites (ordered by user) ---
	const favorites = computed<BookmarkEntry[]>(() => {
		return favoritePaths.value.map((path) => ({
			path,
			name: extractName(path),
			exists: !nonExistentPaths.value.has(path),
		}));
	});

	// --- Computed: History (last 50, ordered by most recent) ---
	const history = computed<BookmarkEntry[]>(() => {
		return userStatsStore.sortedHistory
			.filter((item) => !item.isFile)
			.slice(0, HISTORY_LIMIT)
			.map((item) => ({
				path: item.path,
				name: extractName(item.path),
				exists: !nonExistentPaths.value.has(item.path),
			}));
	});

	// --- Computed: Frequent (top 20, ordered by open count desc) ---
	const frequent = computed<BookmarkEntry[]>(() => {
		return userStatsStore.sortedFrequentItems
			.filter((item) => !item.isFile)
			.slice(0, FREQUENT_LIMIT)
			.map((item) => ({
				path: item.path,
				name: extractName(item.path),
				exists: !nonExistentPaths.value.has(item.path),
			}));
	});

	// --- Methods ---

	function addFavorite(path: string): void {
		if (isFavorite(path)) return;
		favoritePaths.value.push(path);
		persistFavorites();
		// Also sync with user-stats store
		userStatsStore.addToFavorites(path);
	}

	function removeFavorite(path: string): void {
		const index = favoritePaths.value.indexOf(path);
		if (index === -1) return;
		favoritePaths.value.splice(index, 1);
		persistFavorites();
		// Also sync with user-stats store
		userStatsStore.removeFromFavorites(path);
	}

	function reorderFavorite(fromIndex: number, toIndex: number): void {
		if (
			fromIndex < 0 ||
			fromIndex >= favoritePaths.value.length ||
			toIndex < 0 ||
			toIndex >= favoritePaths.value.length
		) {
			return;
		}
		const [item] = favoritePaths.value.splice(fromIndex, 1);
		favoritePaths.value.splice(toIndex, 0, item);
		persistFavorites();
	}

	function isFavorite(path: string): boolean {
		return favoritePaths.value.includes(path);
	}

	function markPathNonExistent(path: string): void {
		nonExistentPaths.value.add(path);
	}

	function markPathExists(path: string): void {
		nonExistentPaths.value.delete(path);
	}

	/**
	 * Sync favorites from user-stats store (call on init).
	 * Ensures the local ordered list includes all favorites from user-stats.
	 */
	function syncFromUserStats(): void {
		const statsFavorites = userStatsStore.favorites.map((f) => f.path);
		// Add any favorites from user-stats that aren't in our ordered list
		for (const path of statsFavorites) {
			if (!favoritePaths.value.includes(path)) {
				favoritePaths.value.push(path);
			}
		}
		// Remove any from our list that are no longer in user-stats
		favoritePaths.value = favoritePaths.value.filter((p) => statsFavorites.includes(p));
		persistFavorites();
	}

	// --- Persistence helpers ---

	function persistFavorites(): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(favoritePaths.value));
		} catch (error) {
			console.error('Failed to persist bookmarks favorites:', error);
		}
	}

	return {
		favorites,
		history,
		frequent,
		favoritePaths,
		nonExistentPaths,
		addFavorite,
		removeFavorite,
		reorderFavorite,
		isFavorite,
		markPathNonExistent,
		markPathExists,
		syncFromUserStats,
	};
});
