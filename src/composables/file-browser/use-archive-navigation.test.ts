import { describe, expect, it } from 'vitest';
import { isNavigableArchive } from './use-archive-navigation';
import type { DirEntry } from '@/types/dir-entry';

function makeDirEntry(overrides: Partial<DirEntry> = {}): DirEntry {
	return {
		name: 'test.zip',
		path: '/home/user/test.zip',
		ext: 'zip',
		size: 1024,
		item_count: null,
		modified_time: Date.now(),
		accessed_time: Date.now(),
		created_time: Date.now(),
		mime: 'application/zip',
		is_file: true,
		is_dir: false,
		is_symlink: false,
		is_hidden: false,
		...overrides,
	};
}

describe('isNavigableArchive', () => {
	it('returns true for .zip files', () => {
		const entry = makeDirEntry({ name: 'archive.zip', ext: 'zip', is_file: true });
		expect(isNavigableArchive(entry)).toBe(true);
	});

	it('returns true for .7z files', () => {
		const entry = makeDirEntry({ name: 'archive.7z', ext: '7z', is_file: true });
		expect(isNavigableArchive(entry)).toBe(true);
	});

	it('returns true for .tar files', () => {
		const entry = makeDirEntry({ name: 'archive.tar', ext: 'tar', is_file: true });
		expect(isNavigableArchive(entry)).toBe(true);
	});

	it('returns true for .tar.gz files', () => {
		const entry = makeDirEntry({
			name: 'archive.tar.gz',
			ext: 'gz',
			is_file: true,
		});
		expect(isNavigableArchive(entry)).toBe(true);
	});

	it('returns true for .gz files', () => {
		const entry = makeDirEntry({ name: 'data.gz', ext: 'gz', is_file: true });
		expect(isNavigableArchive(entry)).toBe(true);
	});

	it('returns false for directories', () => {
		const entry = makeDirEntry({ name: 'folder.zip', ext: 'zip', is_file: false, is_dir: true });
		expect(isNavigableArchive(entry)).toBe(false);
	});

	it('returns false for non-archive files', () => {
		const entry = makeDirEntry({ name: 'document.pdf', ext: 'pdf', is_file: true });
		expect(isNavigableArchive(entry)).toBe(false);
	});

	it('returns false for files without extension', () => {
		const entry = makeDirEntry({ name: 'noext', ext: null, is_file: true });
		expect(isNavigableArchive(entry)).toBe(false);
	});

	it('returns false for .rar files (not in navigable list)', () => {
		const entry = makeDirEntry({ name: 'archive.rar', ext: 'rar', is_file: true });
		expect(isNavigableArchive(entry)).toBe(false);
	});
});
