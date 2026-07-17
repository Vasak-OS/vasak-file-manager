import { describe, expect, it } from 'vitest';

/**
 * Unit tests for compress dialog validation logic.
 * These test the pure validation functions extracted from the component.
 */

const MAX_NAME_LENGTH = 255;

// Validation logic extracted from CompressDialogComponent
function isValidCompressName(name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed) return false;
	if (trimmed.length > MAX_NAME_LENGTH) return false;

	// biome-ignore lint/suspicious/noControlCharactersInRegex: checking for control chars
	const invalidChars = /[<>:"/\\|?*\u0000-\u001F]/;
	if (invalidChars.test(trimmed)) return false;

	if (trimmed === '.' || trimmed === '..') return false;

	return true;
}

function getDefaultCompressName(
	entries: { name: string; ext: string | null }[],
	currentPath: string
): string {
	if (entries.length === 1) {
		const name = entries[0].name;
		const dotIdx = name.lastIndexOf('.');
		return dotIdx > 0 ? name.slice(0, dotIdx) : name;
	}
	const parts = currentPath.split('/').filter(Boolean);
	return parts[parts.length - 1] || 'archive';
}

describe('CompressDialogComponent - Validation', () => {
	it('rejects empty name', () => {
		expect(isValidCompressName('')).toBe(false);
		expect(isValidCompressName('   ')).toBe(false);
	});

	it('accepts valid filename', () => {
		expect(isValidCompressName('my-archive')).toBe(true);
		expect(isValidCompressName('backup_2024')).toBe(true);
		expect(isValidCompressName('file with spaces')).toBe(true);
	});

	it('rejects names exceeding 255 characters', () => {
		const longName = 'a'.repeat(256);
		expect(isValidCompressName(longName)).toBe(false);
	});

	it('accepts names at exactly 255 characters', () => {
		const maxName = 'a'.repeat(255);
		expect(isValidCompressName(maxName)).toBe(true);
	});

	it('rejects names with invalid characters', () => {
		expect(isValidCompressName('file<name')).toBe(false);
		expect(isValidCompressName('file>name')).toBe(false);
		expect(isValidCompressName('file:name')).toBe(false);
		expect(isValidCompressName('file"name')).toBe(false);
		expect(isValidCompressName('file/name')).toBe(false);
		expect(isValidCompressName('file\\name')).toBe(false);
		expect(isValidCompressName('file|name')).toBe(false);
		expect(isValidCompressName('file?name')).toBe(false);
		expect(isValidCompressName('file*name')).toBe(false);
	});

	it('rejects "." and ".." as names', () => {
		expect(isValidCompressName('.')).toBe(false);
		expect(isValidCompressName('..')).toBe(false);
	});

	it('accepts names starting with dot (hidden files)', () => {
		expect(isValidCompressName('.hidden')).toBe(true);
	});
});

describe('CompressDialogComponent - Default Name', () => {
	it('uses filename without extension for single file', () => {
		const entries = [{ name: 'document.pdf', ext: 'pdf' }];
		expect(getDefaultCompressName(entries, '/home/user')).toBe('document');
	});

	it('uses full name for file without extension', () => {
		const entries = [{ name: 'Makefile', ext: null }];
		expect(getDefaultCompressName(entries, '/home/user')).toBe('Makefile');
	});

	it('uses parent directory name for multiple files', () => {
		const entries = [
			{ name: 'file1.txt', ext: 'txt' },
			{ name: 'file2.txt', ext: 'txt' },
		];
		expect(getDefaultCompressName(entries, '/home/user/project/')).toBe('project');
	});

	it('uses "archive" when path has no meaningful segment', () => {
		const entries = [
			{ name: 'a.txt', ext: 'txt' },
			{ name: 'b.txt', ext: 'txt' },
		];
		expect(getDefaultCompressName(entries, '/')).toBe('archive');
	});
});
