import { describe, it, expect } from 'vitest';
import { computeDiff, applyDiff } from './directory-diff';
import type { DirEntry } from '@/types/dir-entry';

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

describe('computeDiff', () => {
	it('should detect added entries', () => {
		const oldEntries: DirEntry[] = [makeDirEntry({ path: '/a', name: 'a' })];
		const newEntries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a' }),
			makeDirEntry({ path: '/b', name: 'b' }),
		];

		const diff = computeDiff(oldEntries, newEntries);

		expect(diff.added).toHaveLength(1);
		expect(diff.added[0].path).toBe('/b');
		expect(diff.removed).toHaveLength(0);
		expect(diff.updated).toHaveLength(0);
	});

	it('should detect removed entries', () => {
		const oldEntries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a' }),
			makeDirEntry({ path: '/b', name: 'b' }),
		];
		const newEntries: DirEntry[] = [makeDirEntry({ path: '/a', name: 'a' })];

		const diff = computeDiff(oldEntries, newEntries);

		expect(diff.added).toHaveLength(0);
		expect(diff.removed).toEqual(['/b']);
		expect(diff.updated).toHaveLength(0);
	});

	it('should detect updated entries by size change', () => {
		const oldEntries: DirEntry[] = [makeDirEntry({ path: '/a', name: 'a', size: 100 })];
		const newEntries: DirEntry[] = [makeDirEntry({ path: '/a', name: 'a', size: 200 })];

		const diff = computeDiff(oldEntries, newEntries);

		expect(diff.added).toHaveLength(0);
		expect(diff.removed).toHaveLength(0);
		expect(diff.updated).toHaveLength(1);
		expect(diff.updated[0].size).toBe(200);
	});

	it('should detect updated entries by modified_time change', () => {
		const oldEntries: DirEntry[] = [makeDirEntry({ path: '/a', name: 'a', modified_time: 1000 })];
		const newEntries: DirEntry[] = [makeDirEntry({ path: '/a', name: 'a', modified_time: 2000 })];

		const diff = computeDiff(oldEntries, newEntries);

		expect(diff.updated).toHaveLength(1);
		expect(diff.updated[0].modified_time).toBe(2000);
	});

	it('should detect updated entries by name change', () => {
		const oldEntries: DirEntry[] = [makeDirEntry({ path: '/a', name: 'old-name' })];
		const newEntries: DirEntry[] = [makeDirEntry({ path: '/a', name: 'new-name' })];

		const diff = computeDiff(oldEntries, newEntries);

		expect(diff.updated).toHaveLength(1);
		expect(diff.updated[0].name).toBe('new-name');
	});

	it('should not mark entries as updated if metadata is the same', () => {
		const entry = makeDirEntry({ path: '/a', name: 'a', size: 100, modified_time: 1000 });
		const diff = computeDiff([entry], [{ ...entry }]);

		expect(diff.added).toHaveLength(0);
		expect(diff.removed).toHaveLength(0);
		expect(diff.updated).toHaveLength(0);
	});

	it('should handle empty old list (all entries are added)', () => {
		const newEntries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a' }),
			makeDirEntry({ path: '/b', name: 'b' }),
		];

		const diff = computeDiff([], newEntries);

		expect(diff.added).toHaveLength(2);
		expect(diff.removed).toHaveLength(0);
		expect(diff.updated).toHaveLength(0);
	});

	it('should handle empty new list (all entries are removed)', () => {
		const oldEntries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a' }),
			makeDirEntry({ path: '/b', name: 'b' }),
		];

		const diff = computeDiff(oldEntries, []);

		expect(diff.added).toHaveLength(0);
		expect(diff.removed).toEqual(['/a', '/b']);
		expect(diff.updated).toHaveLength(0);
	});

	it('should handle both empty lists', () => {
		const diff = computeDiff([], []);

		expect(diff.added).toHaveLength(0);
		expect(diff.removed).toHaveLength(0);
		expect(diff.updated).toHaveLength(0);
	});

	it('should handle mixed changes (add, remove, update)', () => {
		const oldEntries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a', size: 100 }),
			makeDirEntry({ path: '/b', name: 'b', size: 200 }),
			makeDirEntry({ path: '/c', name: 'c', size: 300 }),
		];
		const newEntries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a', size: 100 }), // unchanged
			makeDirEntry({ path: '/b', name: 'b', size: 999 }), // updated
			makeDirEntry({ path: '/d', name: 'd', size: 400 }), // added
		];

		const diff = computeDiff(oldEntries, newEntries);

		expect(diff.added).toHaveLength(1);
		expect(diff.added[0].path).toBe('/d');
		expect(diff.removed).toEqual(['/c']);
		expect(diff.updated).toHaveLength(1);
		expect(diff.updated[0].path).toBe('/b');
		expect(diff.updated[0].size).toBe(999);
	});
});

describe('applyDiff', () => {
	it('should apply added entries', () => {
		const entries: DirEntry[] = [makeDirEntry({ path: '/a', name: 'a' })];
		const diff = {
			added: [makeDirEntry({ path: '/b', name: 'b' })],
			removed: [],
			updated: [],
		};

		const result = applyDiff(entries, diff);

		expect(result).toHaveLength(2);
		expect(result[1].path).toBe('/b');
	});

	it('should apply removed entries', () => {
		const entries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a' }),
			makeDirEntry({ path: '/b', name: 'b' }),
		];
		const diff = {
			added: [],
			removed: ['/b'],
			updated: [],
		};

		const result = applyDiff(entries, diff);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe('/a');
	});

	it('should apply updated entries', () => {
		const entries: DirEntry[] = [makeDirEntry({ path: '/a', name: 'a', size: 100 })];
		const diff = {
			added: [],
			removed: [],
			updated: [makeDirEntry({ path: '/a', name: 'a', size: 999 })],
		};

		const result = applyDiff(entries, diff);

		expect(result).toHaveLength(1);
		expect(result[0].size).toBe(999);
	});

	it('should not mutate original entries array', () => {
		const entries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a' }),
			makeDirEntry({ path: '/b', name: 'b' }),
		];
		const diff = {
			added: [makeDirEntry({ path: '/c', name: 'c' })],
			removed: ['/b'],
			updated: [],
		};

		applyDiff(entries, diff);

		expect(entries).toHaveLength(2);
		expect(entries[1].path).toBe('/b');
	});

	it('should produce correct result for mixed diff', () => {
		const entries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a', size: 100 }),
			makeDirEntry({ path: '/b', name: 'b', size: 200 }),
			makeDirEntry({ path: '/c', name: 'c', size: 300 }),
		];
		const diff = {
			added: [makeDirEntry({ path: '/d', name: 'd', size: 400 })],
			removed: ['/c'],
			updated: [makeDirEntry({ path: '/b', name: 'b', size: 999 })],
		};

		const result = applyDiff(entries, diff);

		expect(result).toHaveLength(3);
		expect(result[0].path).toBe('/a');
		expect(result[0].size).toBe(100);
		expect(result[1].path).toBe('/b');
		expect(result[1].size).toBe(999);
		expect(result[2].path).toBe('/d');
		expect(result[2].size).toBe(400);
	});

	it('round-trip: applying computeDiff result to old list yields new list', () => {
		const oldEntries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a', size: 100 }),
			makeDirEntry({ path: '/b', name: 'b', size: 200 }),
			makeDirEntry({ path: '/c', name: 'c', size: 300 }),
		];
		const newEntries: DirEntry[] = [
			makeDirEntry({ path: '/a', name: 'a', size: 150 }),
			makeDirEntry({ path: '/c', name: 'c', size: 300 }),
			makeDirEntry({ path: '/d', name: 'd', size: 400 }),
		];

		const diff = computeDiff(oldEntries, newEntries);
		const result = applyDiff(oldEntries, diff);

		// The result should be equivalent to newEntries
		expect(result).toHaveLength(newEntries.length);
		for (let i = 0; i < newEntries.length; i++) {
			expect(result[i].path).toBe(newEntries[i].path);
			expect(result[i].name).toBe(newEntries[i].name);
			expect(result[i].size).toBe(newEntries[i].size);
			expect(result[i].modified_time).toBe(newEntries[i].modified_time);
		}
	});
});
