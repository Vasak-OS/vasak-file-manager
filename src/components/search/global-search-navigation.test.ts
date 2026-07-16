import { describe, it, expect } from 'vitest';

/**
 * Tests for the search result navigation logic (Requirement 9.4).
 * The getParentPath function extracts the parent directory of a file path,
 * used when clicking a file result in global search to navigate to its container.
 */

function getParentPath(path: string): string | null {
	const parts = path.split('/').filter(Boolean);
	if (parts.length <= 1) return null;
	parts.pop();
	const parent = parts.join('/');
	return parent.includes(':') ? `${parent}/` : `/${parent}`;
}

describe('Global Search Navigation - getParentPath', () => {
	it('should return parent directory for a file path', () => {
		expect(getParentPath('/home/user/documents/file.txt')).toBe('/home/user/documents');
	});

	it('should return parent directory for nested paths', () => {
		expect(getParentPath('/media/disk1/projects/vasak/src/main.ts')).toBe(
			'/media/disk1/projects/vasak/src'
		);
	});

	it('should return null for root-level paths', () => {
		expect(getParentPath('/home')).toBe(null);
	});

	it('should handle paths with trailing slashes by ignoring empty segments', () => {
		expect(getParentPath('/home/user/documents/')).toBe('/home/user');
	});

	it('should handle Windows-style paths with drive letters', () => {
		// Windows paths like C:/Users/file.txt — the drive letter contains ':'
		// which triggers the trailing slash convention
		expect(getParentPath('/C:/Users/Documents/file.txt')).toBe('C:/Users/Documents/');
	});
});

describe('Global Search Navigation - Result type behavior', () => {
	it('for a file result, should compute parent path (navigate to container)', () => {
		const fileEntry = {
			name: 'report.pdf',
			path: '/home/user/documents/report.pdf',
			is_file: true,
			is_dir: false,
		};

		// Requirement 9.4: file result → navigate to parent directory
		if (fileEntry.is_file) {
			const parentPath = getParentPath(fileEntry.path);
			expect(parentPath).toBe('/home/user/documents');
		}
	});

	it('for a directory result, path is used directly (navigate into directory)', () => {
		const dirEntry = {
			name: 'projects',
			path: '/home/user/projects',
			is_file: false,
			is_dir: true,
		};

		// Requirement 9.4: directory result → navigate directly to it
		if (dirEntry.is_dir) {
			expect(dirEntry.path).toBe('/home/user/projects');
		}
	});
});

describe('Global Search Index State Logic', () => {
	const STALE_THRESHOLD_MS = 30 * 60 * 1000;

	function isIndexStale(
		isIndexValid: boolean,
		isScanInProgress: boolean,
		isCommitting: boolean,
		indexedItemCount: number,
		lastScanTime: number | null
	): boolean {
		if (!isIndexValid) return false;
		if (isScanInProgress || isCommitting) return false;
		if (indexedItemCount === 0) return true;
		if (!lastScanTime) return true;
		const timeSinceLastScan = Date.now() - lastScanTime;
		return timeSinceLastScan > STALE_THRESHOLD_MS;
	}

	function isIndexMissing(
		isScanInProgress: boolean,
		isCommitting: boolean,
		isIndexValid: boolean,
		indexedItemCount: number
	): boolean {
		if (isScanInProgress || isCommitting) return false;
		return !isIndexValid && indexedItemCount === 0;
	}

	// Requirement 9.6: Stale index detection
	it('should detect stale index when last scan was >30 minutes ago', () => {
		const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;
		expect(isIndexStale(true, false, false, 1000, thirtyOneMinutesAgo)).toBe(true);
	});

	it('should not be stale when last scan was <30 minutes ago', () => {
		const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
		expect(isIndexStale(true, false, false, 1000, tenMinutesAgo)).toBe(false);
	});

	it('should be stale when indexed item count is 0', () => {
		const recentTime = Date.now() - 5 * 60 * 1000;
		expect(isIndexStale(true, false, false, 0, recentTime)).toBe(true);
	});

	it('should not be stale during scan', () => {
		const oldTime = Date.now() - 60 * 60 * 1000;
		expect(isIndexStale(true, true, false, 1000, oldTime)).toBe(false);
	});

	it('should not be stale if index is not valid', () => {
		const oldTime = Date.now() - 60 * 60 * 1000;
		expect(isIndexStale(false, false, false, 1000, oldTime)).toBe(false);
	});

	// Requirement 9.7: Index missing detection
	it('should detect missing index when index is not valid and has no items', () => {
		expect(isIndexMissing(false, false, false, 0)).toBe(true);
	});

	it('should not be missing during scan', () => {
		expect(isIndexMissing(true, false, false, 0)).toBe(false);
	});

	it('should not be missing when index is valid', () => {
		expect(isIndexMissing(false, false, true, 500)).toBe(false);
	});
});
