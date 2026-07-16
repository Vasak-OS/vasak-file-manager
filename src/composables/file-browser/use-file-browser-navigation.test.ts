import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useDirectoryCacheStore } from '@/stores/runtime/directory-cache';
import type { DirContents, DirEntry } from '@/types/dir-entry';

/**
 * Tests for the Directory Cache integration in file browser navigation.
 * Validates Requirements 3.2, 3.3, 3.5.
 *
 * Since useFileBrowserNavigation depends heavily on Tauri invoke/listen
 * and Vue composable lifecycle (onUnmounted), we test the cache store
 * interactions directly to validate the integration contract.
 */

function makeDirEntry(overrides: Partial<DirEntry> & { path: string; name: string }): DirEntry {
	return {
		ext: null,
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
		...overrides,
	};
}

function makeDirContents(path: string, entries: DirEntry[]): DirContents {
	const dirCount = entries.filter((e) => e.is_dir).length;
	const fileCount = entries.filter((e) => e.is_file).length;
	return {
		path,
		entries,
		total_count: entries.length,
		dir_count: dirCount,
		file_count: fileCount,
	};
}

describe('Directory Cache Integration (Req 3.2, 3.3, 3.5)', () => {
	let cache: ReturnType<typeof useDirectoryCacheStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		cache = useDirectoryCacheStore();
	});

	describe('Req 3.2: Serve cached data in <50ms', () => {
		it('should return cached data immediately after storing', () => {
			const entries = [
				makeDirEntry({ path: '/home/user/docs/file1.txt', name: 'file1.txt' }),
				makeDirEntry({ path: '/home/user/docs/file2.txt', name: 'file2.txt' }),
			];
			const contents = makeDirContents('/home/user/docs/', entries);

			cache.set('/home/user/docs/', contents);

			const start = performance.now();
			const cached = cache.get('/home/user/docs/');
			const elapsed = performance.now() - start;

			expect(cached).not.toBeNull();
			expect(cached!.entries).toHaveLength(2);
			expect(cached!.path).toBe('/home/user/docs/');
			// Synchronous retrieval should be well under 50ms
			expect(elapsed).toBeLessThan(50);
		});

		it('should serve cached data with correct counts', () => {
			const entries = [
				makeDirEntry({ path: '/home/user/docs/subdir', name: 'subdir', is_dir: true, is_file: false }),
				makeDirEntry({ path: '/home/user/docs/file.txt', name: 'file.txt' }),
				makeDirEntry({ path: '/home/user/docs/img.png', name: 'img.png' }),
			];
			const contents = makeDirContents('/home/user/docs/', entries);

			cache.set('/home/user/docs/', contents);
			const cached = cache.get('/home/user/docs/');

			expect(cached!.totalCount).toBe(3);
			expect(cached!.dirCount).toBe(1);
			expect(cached!.fileCount).toBe(2);
		});

		it('should update LRU order on get (promoting for stale-while-revalidate)', () => {
			const path1 = '/home/user/path1/';
			const path2 = '/home/user/path2/';
			const path3 = '/home/user/path3/';

			cache.set(path1, makeDirContents(path1, []));
			cache.set(path2, makeDirContents(path2, []));
			cache.set(path3, makeDirContents(path3, []));

			// Access path1 to promote it (simulates navigating back)
			cache.get(path1);

			// path2 is now the least recently used
			expect(cache.accessOrder[0]).toBe(path2);
			expect(cache.accessOrder[cache.accessOrder.length - 1]).toBe(path1);
		});
	});

	describe('Req 3.3: Invalidate on watcher event', () => {
		it('should invalidate a specific path (simulates watcher notification)', () => {
			const path = '/home/user/docs/';
			cache.set(path, makeDirContents(path, [makeDirEntry({ path: '/home/user/docs/a.txt', name: 'a.txt' })]));

			expect(cache.has(path)).toBe(true);

			// Simulate watcher event: invalidate the cached path
			cache.invalidate(path);

			expect(cache.has(path)).toBe(false);
			expect(cache.get(path)).toBeNull();
		});

		it('should only invalidate the specific changed directory, not others', () => {
			const path1 = '/home/user/docs/';
			const path2 = '/home/user/music/';

			cache.set(path1, makeDirContents(path1, []));
			cache.set(path2, makeDirContents(path2, []));

			// Watcher notifies change only in path1
			cache.invalidate(path1);

			expect(cache.has(path1)).toBe(false);
			expect(cache.has(path2)).toBe(true);
		});

		it('should remove the invalidated path from accessOrder', () => {
			const path = '/home/user/docs/';
			cache.set(path, makeDirContents(path, []));

			expect(cache.accessOrder).toContain(path);

			cache.invalidate(path);

			expect(cache.accessOrder).not.toContain(path);
		});
	});

	describe('Req 3.5: Invalidate on manual refresh', () => {
		it('should clear cache entry on manual refresh (invalidate + fresh read)', () => {
			const path = '/home/user/docs/';
			const oldEntries = [makeDirEntry({ path: '/home/user/docs/old.txt', name: 'old.txt' })];
			cache.set(path, makeDirContents(path, oldEntries));

			// Simulate manual refresh: invalidate then store fresh data
			cache.invalidate(path);
			expect(cache.has(path)).toBe(false);

			// After fresh backend read, store new data
			const newEntries = [
				makeDirEntry({ path: '/home/user/docs/old.txt', name: 'old.txt' }),
				makeDirEntry({ path: '/home/user/docs/new.txt', name: 'new.txt' }),
			];
			cache.set(path, makeDirContents(path, newEntries));

			const cached = cache.get(path);
			expect(cached!.entries).toHaveLength(2);
		});

		it('invalidateAll should clear all cached directories', () => {
			cache.set('/path/a/', makeDirContents('/path/a/', []));
			cache.set('/path/b/', makeDirContents('/path/b/', []));
			cache.set('/path/c/', makeDirContents('/path/c/', []));

			cache.invalidateAll();

			expect(cache.has('/path/a/')).toBe(false);
			expect(cache.has('/path/b/')).toBe(false);
			expect(cache.has('/path/c/')).toBe(false);
			expect(cache.accessOrder).toHaveLength(0);
		});
	});

	describe('Background verification via applyDiff', () => {
		it('should update cache entry via applyDiff when backend returns changes', () => {
			const path = '/home/user/docs/';
			const entries = [
				makeDirEntry({ path: '/home/user/docs/a.txt', name: 'a.txt', size: 100 }),
				makeDirEntry({ path: '/home/user/docs/b.txt', name: 'b.txt', size: 200 }),
			];
			cache.set(path, makeDirContents(path, entries));

			// Simulate background verify detecting changes:
			// - b.txt size changed
			// - c.txt was added
			const added = [makeDirEntry({ path: '/home/user/docs/c.txt', name: 'c.txt', size: 50 })];
			const removed: string[] = [];
			const updated = [makeDirEntry({ path: '/home/user/docs/b.txt', name: 'b.txt', size: 300 })];

			cache.applyDiff(path, added, removed, updated);

			const cached = cache.get(path);
			expect(cached!.entries).toHaveLength(3);
			expect(cached!.totalCount).toBe(3);

			const bEntry = cached!.entries.find((e) => e.path === '/home/user/docs/b.txt');
			expect(bEntry!.size).toBe(300);

			const cEntry = cached!.entries.find((e) => e.path === '/home/user/docs/c.txt');
			expect(cEntry).toBeDefined();
		});

		it('should handle removal via applyDiff', () => {
			const path = '/home/user/docs/';
			const entries = [
				makeDirEntry({ path: '/home/user/docs/a.txt', name: 'a.txt' }),
				makeDirEntry({ path: '/home/user/docs/b.txt', name: 'b.txt' }),
			];
			cache.set(path, makeDirContents(path, entries));

			cache.applyDiff(path, [], ['/home/user/docs/b.txt'], []);

			const cached = cache.get(path);
			expect(cached!.entries).toHaveLength(1);
			expect(cached!.entries[0].path).toBe('/home/user/docs/a.txt');
			expect(cached!.totalCount).toBe(1);
		});

		it('applyDiff should be no-op if path is not cached', () => {
			// Should not throw
			cache.applyDiff('/nonexistent/', [makeDirEntry({ path: '/x', name: 'x' })], [], []);
			expect(cache.has('/nonexistent/')).toBe(false);
		});
	});

	describe('Cache store integration with navigation flow', () => {
		it('should store fresh data after first read (set called after backend)', () => {
			const path = '/home/user/new-dir/';
			expect(cache.has(path)).toBe(false);

			// Simulate: backend returns data, navigation stores it
			const contents = makeDirContents(path, [
				makeDirEntry({ path: '/home/user/new-dir/file.txt', name: 'file.txt' }),
			]);
			cache.set(path, contents);

			expect(cache.has(path)).toBe(true);
			const cached = cache.get(path);
			expect(cached!.entries).toHaveLength(1);
		});

		it('should handle repeated navigation to same path (get promotes LRU)', () => {
			// Fill cache with several entries
			for (let i = 0; i < 5; i++) {
				const p = `/path/${i}/`;
				cache.set(p, makeDirContents(p, []));
			}

			// Navigate back to path 0 multiple times
			cache.get('/path/0/');
			cache.get('/path/0/');

			// path/0/ should be most recently used
			expect(cache.accessOrder[cache.accessOrder.length - 1]).toBe('/path/0/');
		});

		it('forceLoading scenario: after invalidate, cache.get returns null', () => {
			const path = '/home/user/docs/';
			cache.set(path, makeDirContents(path, []));

			// Manual refresh: invalidate first
			cache.invalidate(path);

			// readDir with forceLoading=true skips cache — cache.get should return null
			expect(cache.get(path)).toBeNull();
		});
	});
});
