import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DirContents, DirEntry } from '@/types/dir-entry';
import { applyDiff as applyDiffUtil } from '@/utils/directory-diff';

export interface CachedDirectory {
	path: string;
	entries: DirEntry[];
	timestamp: number;
	totalCount: number;
	dirCount: number;
	fileCount: number;
}

const MAX_CAPACITY = 50;

export const useDirectoryCacheStore = defineStore('directory-cache', () => {
	/** Map of path -> CachedDirectory */
	const cache = ref<Map<string, CachedDirectory>>(new Map());

	/**
	 * Ordered list of paths tracking access recency.
	 * The most recently accessed path is at the end.
	 */
	const accessOrder = ref<string[]>([]);

	/** Maximum number of directories to cache */
	const capacity = MAX_CAPACITY;

	/**
	 * Promote a path to most-recently-used position in the access order.
	 */
	function promote(path: string): void {
		const index = accessOrder.value.indexOf(path);
		if (index !== -1) {
			accessOrder.value.splice(index, 1);
		}
		accessOrder.value.push(path);
	}

	/**
	 * Evict the least recently used entry (first element in accessOrder).
	 */
	function evictLRU(): void {
		const lruPath = accessOrder.value.shift();
		if (lruPath === undefined) return;
		cache.value.delete(lruPath);
	}

	/**
	 * Get a cached directory by path. Updates LRU order (promotes entry).
	 * Returns null if path is not cached.
	 */
	function get(path: string): CachedDirectory | null {
		const entry = cache.value.get(path);
		if (!entry) return null;
		promote(path);
		return entry;
	}

	/**
	 * Store a directory listing in the cache with current timestamp.
	 * Evicts the least recently used entry if at capacity.
	 */
	function set(path: string, contents: DirContents): void {
		const alreadyExists = cache.value.has(path);

		const cached: CachedDirectory = {
			path: contents.path,
			entries: [...contents.entries],
			timestamp: Date.now(),
			totalCount: contents.total_count,
			dirCount: contents.dir_count,
			fileCount: contents.file_count,
		};

		if (!alreadyExists && cache.value.size >= capacity) {
			evictLRU();
		}

		cache.value.set(path, cached);
		promote(path);
	}

	/**
	 * Invalidate (remove) a specific directory from the cache.
	 */
	function invalidate(path: string): void {
		cache.value.delete(path);
		const index = accessOrder.value.indexOf(path);
		if (index !== -1) {
			accessOrder.value.splice(index, 1);
		}
	}

	/**
	 * Invalidate all cached directories.
	 */
	function invalidateAll(): void {
		cache.value.clear();
		accessOrder.value = [];
	}

	/**
	 * Check if a path has a valid cache entry.
	 * Does NOT update LRU order (peek only).
	 */
	function has(path: string): boolean {
		return cache.value.has(path);
	}

	/**
	 * Apply a minimal diff to a cached directory without replacing the whole list.
	 * - added: entries to insert
	 * - removed: paths of entries to remove
	 * - updated: entries whose metadata changed (matched by path)
	 */
	function applyDiff(
		path: string,
		added: DirEntry[],
		removed: string[],
		updated: DirEntry[]
	): void {
		const entry = cache.value.get(path);
		if (!entry) return;

		const entries = applyDiffUtil(entry.entries, { added, removed, updated });

		// Recompute counts
		const dirCount = entries.filter((e) => e.is_dir).length;
		const fileCount = entries.filter((e) => e.is_file).length;

		entry.entries = entries;
		entry.totalCount = entries.length;
		entry.dirCount = dirCount;
		entry.fileCount = fileCount;
		entry.timestamp = Date.now();
	}

	return {
		cache,
		accessOrder,
		capacity,
		get,
		set,
		invalidate,
		invalidateAll,
		has,
		applyDiff,
	};
});
