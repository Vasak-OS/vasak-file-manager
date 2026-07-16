import { describe, it, expect } from 'vitest';
import {
	partitionIntoBatches,
	prioritizePaths,
	getCachedIfTimestampUnchanged,
	MAX_BATCH_SIZE,
	PRIORITY_THRESHOLD,
} from './use-dir-size-batch';

describe('partitionIntoBatches', () => {
	it('should return empty array for empty input', () => {
		expect(partitionIntoBatches([])).toEqual([]);
	});

	it('should return single batch for paths <= MAX_BATCH_SIZE', () => {
		const paths = Array.from({ length: 15 }, (_, i) => `/dir${i}`);
		const batches = partitionIntoBatches(paths);

		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(15);
	});

	it('should return single batch for exactly MAX_BATCH_SIZE paths', () => {
		const paths = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => `/dir${i}`);
		const batches = partitionIntoBatches(paths);

		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(MAX_BATCH_SIZE);
	});

	it('should partition into multiple batches for paths > MAX_BATCH_SIZE', () => {
		const paths = Array.from({ length: 45 }, (_, i) => `/dir${i}`);
		const batches = partitionIntoBatches(paths);

		expect(batches).toHaveLength(3);
		expect(batches[0]).toHaveLength(MAX_BATCH_SIZE);
		expect(batches[1]).toHaveLength(MAX_BATCH_SIZE);
		expect(batches[2]).toHaveLength(5);
	});

	it('should preserve all paths in output (union equals original set)', () => {
		const paths = Array.from({ length: 63 }, (_, i) => `/dir${i}`);
		const batches = partitionIntoBatches(paths);
		const allPaths = batches.flat();

		expect(allPaths).toEqual(paths);
	});

	it('should never exceed MAX_BATCH_SIZE per batch', () => {
		const paths = Array.from({ length: 100 }, (_, i) => `/dir${i}`);
		const batches = partitionIntoBatches(paths);

		for (const batch of batches) {
			expect(batch.length).toBeLessThanOrEqual(MAX_BATCH_SIZE);
		}
	});
});

describe('prioritizePaths', () => {
	it('should return paths unchanged when count <= PRIORITY_THRESHOLD', () => {
		const paths = ['/a', '/b', '/c', '/d', '/e'];
		const isVisible = (p: string) => p === '/c';
		const result = prioritizePaths(paths, isVisible);

		expect(result).toEqual(paths);
	});

	it('should return paths unchanged when no isVisible function provided', () => {
		const paths = Array.from({ length: 10 }, (_, i) => `/dir${i}`);
		const result = prioritizePaths(paths);

		expect(result).toEqual(paths);
	});

	it('should put visible paths first when count > PRIORITY_THRESHOLD', () => {
		const paths = ['/a', '/b', '/c', '/d', '/e', '/f', '/g', '/h'];
		const visibleSet = new Set(['/c', '/f', '/h']);
		const isVisible = (p: string) => visibleSet.has(p);

		const result = prioritizePaths(paths, isVisible);

		// First 3 should be the visible ones
		expect(result.slice(0, 3).sort()).toEqual(['/c', '/f', '/h']);
		// Rest should be not visible
		expect(result.slice(3).sort()).toEqual(['/a', '/b', '/d', '/e', '/g']);
	});

	it('should preserve all paths (no loss or duplication)', () => {
		const paths = Array.from({ length: 10 }, (_, i) => `/dir${i}`);
		const isVisible = (p: string) => p.endsWith('0') || p.endsWith('5');

		const result = prioritizePaths(paths, isVisible);

		expect(result.sort()).toEqual([...paths].sort());
		expect(result).toHaveLength(paths.length);
	});

	it('should handle all paths visible', () => {
		const paths = Array.from({ length: 8 }, (_, i) => `/dir${i}`);
		const isVisible = () => true;

		const result = prioritizePaths(paths, isVisible);

		expect(result).toEqual(paths);
	});

	it('should handle no paths visible', () => {
		const paths = Array.from({ length: 8 }, (_, i) => `/dir${i}`);
		const isVisible = () => false;

		const result = prioritizePaths(paths, isVisible);

		expect(result).toEqual(paths);
	});
});

describe('getCachedIfTimestampUnchanged', () => {
	it('should return null when cached is undefined', () => {
		expect(getCachedIfTimestampUnchanged(undefined, 1000)).toBeNull();
	});

	it('should return null when cached status is not Complete', () => {
		const cached = { size: 100, status: 'Loading', calculatedAt: 2000 };
		expect(getCachedIfTimestampUnchanged(cached, 1000)).toBeNull();
	});

	it('should return cached size when no currentTimestamp provided', () => {
		const cached = { size: 4096, status: 'Complete', calculatedAt: 2000 };
		expect(getCachedIfTimestampUnchanged(cached)).toBe(4096);
	});

	it('should return cached size when currentTimestamp is 0', () => {
		const cached = { size: 4096, status: 'Complete', calculatedAt: 2000 };
		expect(getCachedIfTimestampUnchanged(cached, 0)).toBe(4096);
	});

	it('should return cached size when calculatedAt >= currentTimestamp', () => {
		const cached = { size: 8192, status: 'Complete', calculatedAt: 3000 };
		expect(getCachedIfTimestampUnchanged(cached, 2000)).toBe(8192);
	});

	it('should return cached size when calculatedAt equals currentTimestamp', () => {
		const cached = { size: 8192, status: 'Complete', calculatedAt: 2000 };
		expect(getCachedIfTimestampUnchanged(cached, 2000)).toBe(8192);
	});

	it('should return null when calculatedAt < currentTimestamp (directory was modified)', () => {
		const cached = { size: 8192, status: 'Complete', calculatedAt: 1000 };
		expect(getCachedIfTimestampUnchanged(cached, 2000)).toBeNull();
	});
});
