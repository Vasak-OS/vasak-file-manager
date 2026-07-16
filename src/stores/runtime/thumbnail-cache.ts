import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';

export interface ThumbnailCacheEntry {
	url: string;
	path: string;
	size: number;
	lastAccess: number;
}

const MAX_CAPACITY = 500;

export const useThumbnailCacheStore = defineStore('thumbnail-cache', () => {
	const cache = reactive(new Map<string, ThumbnailCacheEntry>());

	const size = computed(() => cache.size);
	const capacity = MAX_CAPACITY;

	/**
	 * Get a thumbnail URL from the cache.
	 * Updates the lastAccess timestamp (promotes in LRU order).
	 * Returns null if the entry doesn't exist.
	 */
	function get(path: string): string | null {
		const entry = cache.get(path);

		if (!entry) {
			return null;
		}

		// Update last access time (promotes in LRU)
		entry.lastAccess = Date.now();

		return entry.url;
	}

	/**
	 * Store a thumbnail blob in the cache.
	 * Creates an Object URL from the blob and stores it.
	 * Evicts the least recently used entry if capacity is exceeded.
	 * Returns the Object URL for immediate use.
	 */
	function set(path: string, blob: Blob): string {
		// If the path already exists, revoke the old URL first
		const existing = cache.get(path);
		if (existing) {
			URL.revokeObjectURL(existing.url);
		}

		// Evict if at capacity (and not replacing an existing entry)
		if (!existing && cache.size >= MAX_CAPACITY) {
			evictLRU();
		}

		const url = URL.createObjectURL(blob);

		cache.set(path, {
			url,
			path,
			size: blob.size,
			lastAccess: Date.now(),
		});

		return url;
	}

	/**
	 * Check if a path exists in the cache without updating LRU order.
	 */
	function has(path: string): boolean {
		return cache.has(path);
	}

	/**
	 * Invalidate a single cache entry.
	 * Revokes the Object URL to prevent memory leaks.
	 */
	function invalidate(path: string): void {
		const entry = cache.get(path);

		if (entry) {
			URL.revokeObjectURL(entry.url);
			cache.delete(path);
		}
	}

	/**
	 * Clear all entries from the cache.
	 * Revokes all Object URLs to prevent memory leaks.
	 */
	function clear(): void {
		for (const entry of cache.values()) {
			URL.revokeObjectURL(entry.url);
		}

		cache.clear();
	}

	/**
	 * Evict the least recently used entry from the cache.
	 */
	function evictLRU(): void {
		let oldestPath: string | null = null;
		let oldestAccess = Number.POSITIVE_INFINITY;

		for (const [path, entry] of cache) {
			if (entry.lastAccess < oldestAccess) {
				oldestAccess = entry.lastAccess;
				oldestPath = path;
			}
		}

		if (oldestPath) {
			const entry = cache.get(oldestPath);
			if (entry) {
				URL.revokeObjectURL(entry.url);
			}
			cache.delete(oldestPath);
		}
	}

	return {
		cache,
		size,
		capacity,
		get,
		set,
		has,
		invalidate,
		clear,
	};
});
