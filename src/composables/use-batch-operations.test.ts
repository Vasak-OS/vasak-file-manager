import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock Tauri API before importing the composable
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(() => Promise.resolve(() => {})),
}));

import {
	useBatchOperations,
	isDestructiveOperation,
	toFileOperationType,
	mapResolutionToBackend,
	MAX_BATCH_ENTRIES,
} from './use-batch-operations';
import type { DirEntry } from '@/types/dir-entry';

function createMockEntry(name: string, isDir = false): DirEntry {
	return {
		name,
		ext: isDir ? null : (name.split('.').pop() ?? null),
		path: `/home/user/documents/${name}`,
		size: 1024,
		item_count: isDir ? 5 : null,
		modified_time: Date.now(),
		accessed_time: Date.now(),
		created_time: Date.now(),
		mime: isDir ? null : 'application/octet-stream',
		is_file: !isDir,
		is_dir: isDir,
		is_symlink: false,
		is_hidden: false,
	};
}

describe('isDestructiveOperation', () => {
	it('should consider "delete" as destructive', () => {
		expect(isDestructiveOperation('delete')).toBe(true);
	});

	it('should consider "move" as destructive', () => {
		expect(isDestructiveOperation('move')).toBe(true);
	});

	it('should NOT consider "copy" as destructive', () => {
		expect(isDestructiveOperation('copy')).toBe(false);
	});

	it('should NOT consider "compress" as destructive', () => {
		expect(isDestructiveOperation('compress')).toBe(false);
	});

	it('should NOT consider "changePermissions" as destructive', () => {
		expect(isDestructiveOperation('changePermissions')).toBe(false);
	});
});

describe('toFileOperationType', () => {
	it('should map copy to copy', () => {
		expect(toFileOperationType('copy')).toBe('copy');
	});

	it('should map move to move', () => {
		expect(toFileOperationType('move')).toBe('move');
	});

	it('should map delete to delete', () => {
		expect(toFileOperationType('delete')).toBe('delete');
	});

	it('should map compress to compress', () => {
		expect(toFileOperationType('compress')).toBe('compress');
	});

	it('should map changePermissions to copy (closest match)', () => {
		expect(toFileOperationType('changePermissions')).toBe('copy');
	});
});

describe('mapResolutionToBackend', () => {
	it('should map skip to skip', () => {
		expect(mapResolutionToBackend('skip')).toBe('skip');
	});

	it('should map overwrite to replace', () => {
		expect(mapResolutionToBackend('overwrite')).toBe('replace');
	});

	it('should map rename to auto-rename', () => {
		expect(mapResolutionToBackend('rename')).toBe('auto-rename');
	});
});

describe('useBatchOperations', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	describe('confirmation dialog behavior', () => {
		it('should show confirmation dialog for destructive operation with ≥2 entries', () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('file1.txt'), createMockEntry('file2.txt')];
			const processor = vi.fn();

			// Start executeBatch (awaits confirmation)
			batch.executeBatch('delete', entries, undefined, processor);

			// Dialog should be shown
			expect(batch.showConfirmDialog.value).toBe(true);
			expect(batch.confirmDialogType.value).toBe('delete');
			expect(batch.confirmDialogEntries.value).toHaveLength(2);

			// Clean up
			batch.handleConfirmCancel();
		});

		it('should NOT show confirmation for non-destructive operation', () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('file1.txt'), createMockEntry('file2.txt')];
			const processor = vi.fn().mockResolvedValue(undefined);

			// Copy is non-destructive — goes directly to execution
			batch.executeBatch('copy', entries, '/dest', processor);

			// Dialog should NOT be shown
			expect(batch.showConfirmDialog.value).toBe(false);
		});

		it('should NOT show confirmation for destructive op with 1 entry', () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('file1.txt')];
			const processor = vi.fn().mockResolvedValue(undefined);

			batch.executeBatch('delete', entries, undefined, processor);

			// Dialog should NOT be shown (only 1 entry)
			expect(batch.showConfirmDialog.value).toBe(false);
		});

		it('should return null when user cancels confirmation', async () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('file1.txt'), createMockEntry('file2.txt')];
			const processor = vi.fn();

			const promise = batch.executeBatch('delete', entries, undefined, processor);

			// Cancel the confirmation
			batch.handleConfirmCancel();

			const result = await promise;
			expect(result).toBeNull();
		});

		it('should proceed when user confirms', async () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('file1.txt'), createMockEntry('file2.txt')];
			const processor = vi.fn().mockResolvedValue(undefined);

			const promise = batch.executeBatch('delete', entries, undefined, processor);

			// Confirm the dialog
			batch.handleConfirm();

			const result = await promise;
			expect(result).not.toBeNull();
			expect(result!.status).toBe('completed');
			expect(processor).toHaveBeenCalledTimes(2);
		});
	});

	describe('conflict dialog state', () => {
		it('should initially have conflict dialog hidden', () => {
			const batch = useBatchOperations();
			expect(batch.showConflictDialog.value).toBe(false);
			expect(batch.currentConflict.value).toBeNull();
		});

		it('should expose conflict resolution handlers', () => {
			const batch = useBatchOperations();
			expect(batch.handleConflictResolution).toBeTypeOf('function');
			expect(batch.handleConflictCancel).toBeTypeOf('function');
		});
	});

	describe('progress tracking', () => {
		it('should start with zero progress', () => {
			const batch = useBatchOperations();
			expect(batch.batchProgress.value.totalFiles).toBe(0);
			expect(batch.batchProgress.value.completedFiles).toBe(0);
			expect(batch.batchProgress.value.currentFile).toBe('');
			expect(batch.batchProgress.value.currentFileProgress).toBe(0);
		});

		it('should not be in progress initially', () => {
			const batch = useBatchOperations();
			expect(batch.isBatchInProgress.value).toBe(false);
		});

		it('should track progress during batch execution', async () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('a.txt'), createMockEntry('b.txt'), createMockEntry('c.txt')];
			const processor = vi.fn().mockResolvedValue(undefined);

			const result = await batch.executeBatch('copy', entries, '/dest', processor);

			expect(result).not.toBeNull();
			expect(result!.results.successful).toBe(3);
			expect(batch.batchProgress.value.completedFiles).toBe(3);
		});
	});

	describe('entry limit enforcement', () => {
		it('should limit entries to MAX_BATCH_ENTRIES (10,000)', () => {
			const batch = useBatchOperations();

			// Create 10,500 entries
			const entries = Array.from({ length: 10500 }, (_, i) => createMockEntry(`file${i}.txt`));

			// Start a delete operation (destructive, shows dialog since ≥2 entries)
			batch.executeBatch('delete', entries, undefined, vi.fn());

			// The confirmation dialog should show entries limited to 10,000
			expect(batch.confirmDialogEntries.value).toHaveLength(MAX_BATCH_ENTRIES);

			// Clean up
			batch.handleConfirmCancel();
		});
	});

	describe('cancellation', () => {
		it('should stop processing when cancelled', async () => {
			const batch = useBatchOperations();
			let callCount = 0;

			const entries = Array.from({ length: 5 }, (_, i) => createMockEntry(`file${i}.txt`));

			const processor = vi.fn(async () => {
				callCount++;
				if (callCount === 2) {
					// Cancel after second file
					for (const [id] of batch.cancellationFlags) {
						batch.cancelBatch(id);
					}
				}
			});

			const result = await batch.executeBatch('copy', entries, '/dest', processor);

			expect(result).not.toBeNull();
			expect(result!.status).toBe('cancelled');
			expect(result!.results.successful).toBe(2);
			expect(result!.results.skipped).toBe(3); // Remaining 3 were skipped
		});
	});

	describe('error isolation', () => {
		it('should continue processing after individual failure', async () => {
			const batch = useBatchOperations();
			const entries = Array.from({ length: 5 }, (_, i) => createMockEntry(`file${i}.txt`));

			const processor = vi.fn(async (entry: DirEntry) => {
				if (entry.name === 'file2.txt') {
					throw new Error('Permission denied');
				}
			});

			const result = await batch.executeBatch('copy', entries, '/dest', processor);

			expect(result).not.toBeNull();
			expect(result!.results.successful).toBe(4);
			expect(result!.results.failed).toBe(1);
			expect(result!.results.failedPaths[0].path).toContain('file2.txt');
			expect(result!.results.failedPaths[0].error).toContain('Permission denied');
			// successful + failed + skipped = total
			expect(result!.results.successful + result!.results.failed + result!.results.skipped).toBe(5);
		});

		it('should report partial-failure when some files fail', async () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('good.txt'), createMockEntry('bad.txt')];

			const processor = vi.fn(async (entry: DirEntry) => {
				if (entry.name === 'bad.txt') {
					throw new Error('Disk full');
				}
			});

			const result = await batch.executeBatch('copy', entries, '/dest', processor);

			expect(result).not.toBeNull();
			expect(result!.status).toBe('partial-failure');
		});
	});
});
