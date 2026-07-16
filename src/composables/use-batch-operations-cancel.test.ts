import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock Tauri API before importing the composable
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { useBatchOperations, type FileProcessor } from './use-batch-operations';
import { useOperationsStore } from '@/stores/runtime/operations';
import type { DirEntry } from '@/types/dir-entry';

function createMockEntry(name: string, path?: string): DirEntry {
	return {
		name,
		ext: name.split('.').pop() ?? null,
		path: path ?? `/home/user/${name}`,
		size: 1024,
		item_count: null,
		modified_time: Date.now(),
		accessed_time: Date.now(),
		created_time: Date.now(),
		mime: 'application/octet-stream',
		is_file: true,
		is_dir: false,
		is_symlink: false,
		is_hidden: false,
	};
}

describe('useBatchOperations — Cancellation and Error Handling (Task 12.2)', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	describe('cancellation — preserves processed files (Req 11.5)', () => {
		it('should stop processing when cancelled and preserve successful files', async () => {
			const batch = useBatchOperations();
			const entries = [
				createMockEntry('a.txt'),
				createMockEntry('b.txt'),
				createMockEntry('c.txt'),
				createMockEntry('d.txt'),
			];

			let processedCount = 0;
			const processor: FileProcessor = async (_entry) => {
				processedCount++;
				if (processedCount === 2) {
					batch.cancelCurrentBatch();
				}
			};

			const result = await batch.executeBatch('copy', entries, '/dest', processor);

			expect(result).not.toBeNull();
			expect(result!.results.successful).toBe(2);
			expect(result!.results.skipped).toBe(2);
		});

		it('should report processed and pending counts in operations store error', async () => {
			const batch = useBatchOperations();
			const operationsStore = useOperationsStore();
			const entries = Array.from({ length: 10 }, (_, i) => createMockEntry(`file-${i}.txt`));

			let processedCount = 0;
			const result = await batch.executeBatch('copy', entries, '/dest', async (_entry) => {
				processedCount++;
				if (processedCount === 5) {
					batch.cancelCurrentBatch();
				}
			});

			expect(result).not.toBeNull();
			expect(result!.results.successful).toBe(5);
			expect(result!.results.skipped).toBe(5);

			// Verify operations store has correct data
			const ops = Array.from(operationsStore.operations.values());
			const cancelledOp = ops.find((op) => op.status === 'cancelled');
			expect(cancelledOp).toBeDefined();
			expect(cancelledOp!.error).toBeDefined();
			expect(cancelledOp!.error!.successfulFiles).toBe(5);
			expect(cancelledOp!.error!.skippedFiles).toBe(5);
			expect(cancelledOp!.error!.message).toContain('5 of 10 files processed');
			expect(cancelledOp!.error!.message).toContain('pending (cancelled)');
		});

		it('should update operations store status to cancelled', async () => {
			const batch = useBatchOperations();
			const operationsStore = useOperationsStore();
			const entries = [createMockEntry('a.txt'), createMockEntry('b.txt'), createMockEntry('c.txt')];

			let count = 0;
			await batch.executeBatch('copy', entries, '/dest', async (_entry) => {
				count++;
				if (count === 1) {
					batch.cancelCurrentBatch();
				}
			});

			const ops = Array.from(operationsStore.operations.values());
			expect(ops[0].status).toBe('cancelled');
		});

		it('should set isBatchInProgress to false after cancellation', async () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('a.txt'), createMockEntry('b.txt')];

			await batch.executeBatch('copy', entries, '/dest', async (_entry) => {
				batch.cancelCurrentBatch();
			});

			expect(batch.isBatchInProgress.value).toBe(false);
		});
	});

	describe('error isolation — continues on failure (Req 11.6)', () => {
		it('should continue processing remaining files when one fails', async () => {
			const batch = useBatchOperations();
			const entries = [
				createMockEntry('a.txt'),
				createMockEntry('b.txt'),
				createMockEntry('c.txt'),
			];

			const processor: FileProcessor = async (entry) => {
				if (entry.name === 'b.txt') {
					throw new Error('Permission denied');
				}
			};

			const result = await batch.executeBatch('copy', entries, '/dest', processor);

			expect(result).not.toBeNull();
			expect(result!.results.successful).toBe(2); // a.txt and c.txt
			expect(result!.results.failed).toBe(1); // b.txt
		});

		it('should log failed path with error message', async () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('secret.txt', '/protected/secret.txt')];

			const processor: FileProcessor = async (_entry) => {
				throw new Error('File is locked by another process');
			};

			const result = await batch.executeBatch('copy', entries, '/dest', processor);

			expect(result).not.toBeNull();
			expect(result!.results.failedPaths).toHaveLength(1);
			expect(result!.results.failedPaths[0].path).toBe('/protected/secret.txt');
			expect(result!.results.failedPaths[0].error).toContain('File is locked');
		});

		it('should report summary where successful + failed + skipped = total', async () => {
			const batch = useBatchOperations();
			const entries = Array.from({ length: 8 }, (_, i) => createMockEntry(`file-${i}.txt`));

			// Files 2, 4, 6 will fail
			const processor: FileProcessor = async (entry) => {
				const idx = Number.parseInt(entry.name.replace('file-', '').replace('.txt', ''));
				if (idx % 2 === 0 && idx > 0) {
					throw new Error('Access denied');
				}
			};

			// Use 'copy' (non-destructive) to avoid confirmation dialog
			const result = await batch.executeBatch('copy', entries, '/dest', processor);

			expect(result).not.toBeNull();
			const r = result!.results;
			// Invariant: successful + failed + skipped = total entries
			expect(r.successful + r.failed + r.skipped).toBe(8);
			expect(r.successful).toBe(5); // files 0, 1, 3, 5, 7
			expect(r.failed).toBe(3); // files 2, 4, 6
			expect(r.skipped).toBe(0);
		});

		it('should update operations store with partial failure error summary', async () => {
			const batch = useBatchOperations();
			const operationsStore = useOperationsStore();
			const entries = [
				createMockEntry('good.txt'),
				createMockEntry('bad.txt'),
				createMockEntry('good2.txt'),
			];

			const processor: FileProcessor = async (entry) => {
				if (entry.name === 'bad.txt') {
					throw new Error('Disk full');
				}
			};

			await batch.executeBatch('copy', entries, '/dest', processor);

			const ops = Array.from(operationsStore.operations.values());
			const op = ops[0];
			expect(op.error).toBeDefined();
			expect(op.error!.successfulFiles).toBe(2);
			expect(op.error!.failedFiles).toBe(1);
			expect(op.error!.skippedFiles).toBe(0);
		});

		it('should mark operation as failed when ALL files fail', async () => {
			const batch = useBatchOperations();
			const operationsStore = useOperationsStore();
			const entries = [createMockEntry('a.txt'), createMockEntry('b.txt')];

			const processor: FileProcessor = async (_entry) => {
				throw new Error('System error');
			};

			const result = await batch.executeBatch('copy', entries, '/dest', processor);

			expect(result).not.toBeNull();
			expect(result!.results.successful).toBe(0);
			expect(result!.results.failed).toBe(2);

			const ops = Array.from(operationsStore.operations.values());
			expect(ops[0].status).toBe('failed');
		});
	});

	describe('combined cancellation and error handling', () => {
		it('should handle errors before cancellation correctly', async () => {
			const batch = useBatchOperations();
			const entries = [
				createMockEntry('a.txt'),
				createMockEntry('b.txt'),
				createMockEntry('c.txt'),
				createMockEntry('d.txt'),
				createMockEntry('e.txt'),
			];

			let processedCount = 0;
			const result = await batch.executeBatch('copy', entries, '/dest', async (entry) => {
				processedCount++;
				// First file fails
				if (entry.name === 'a.txt') {
					throw new Error('Permission denied');
				}
				// Cancel after third processed (a=fail, b=ok, c=ok -> cancel)
				if (processedCount === 3) {
					batch.cancelCurrentBatch();
				}
			});

			expect(result).not.toBeNull();
			const r = result!.results;
			// a.txt failed, b.txt succeeded, c.txt succeeded, then cancel before d.txt
			expect(r.successful).toBe(2);
			expect(r.failed).toBe(1);
			expect(r.skipped).toBe(2); // d.txt, e.txt pending
			// Invariant: successful + failed + skipped = total
			expect(r.successful + r.failed + r.skipped).toBe(5);
		});

		it('should clean up cancellation flags after operation completes', async () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('a.txt')];
			const processor: FileProcessor = vi.fn().mockResolvedValue(undefined);

			await batch.executeBatch('copy', entries, '/dest', processor);

			expect(batch.cancellationFlags.size).toBe(0);
		});

		it('should clean up cancellation flags after cancellation', async () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('a.txt'), createMockEntry('b.txt')];

			await batch.executeBatch('copy', entries, '/dest', async () => {
				batch.cancelCurrentBatch();
			});

			expect(batch.cancellationFlags.size).toBe(0);
		});
	});

	describe('cancelBatch / cancelCurrentBatch', () => {
		it('cancelBatch should set the flag for a specific batch ID', async () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('a.txt')];

			// Start a batch with a slow processor
			const promise = batch.executeBatch('copy', entries, '/dest', async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));
			});

			// There should be a flag registered
			const batchIds = Array.from(batch.cancellationFlags.keys());
			expect(batchIds).toHaveLength(1);

			expect(batch.isBatchCancelled(batchIds[0])).toBe(false);
			batch.cancelBatch(batchIds[0]);
			expect(batch.isBatchCancelled(batchIds[0])).toBe(true);

			await promise;
		});

		it('cancelBatch should do nothing for unknown batch ID', () => {
			const batch = useBatchOperations();
			// Should not throw
			batch.cancelBatch('nonexistent-id');
			expect(batch.isBatchCancelled('nonexistent-id')).toBe(false);
		});

		it('cancelCurrentBatch should cancel all active batches', async () => {
			const batch = useBatchOperations();
			const entries = [createMockEntry('a.txt'), createMockEntry('b.txt'), createMockEntry('c.txt')];

			let processed = 0;
			const result = await batch.executeBatch('copy', entries, '/dest', async () => {
				processed++;
				if (processed === 1) {
					batch.cancelCurrentBatch();
				}
			});

			expect(result).not.toBeNull();
			expect(result!.results.successful).toBe(1);
			expect(result!.results.skipped).toBe(2);
		});
	});

	describe('OperationTracker integration', () => {
		it('cancelOperation on store should trigger batch cancellation via callback', async () => {
			const batch = useBatchOperations();
			const operationsStore = useOperationsStore();
			const entries = [
				createMockEntry('a.txt'),
				createMockEntry('b.txt'),
				createMockEntry('c.txt'),
				createMockEntry('d.txt'),
			];

			let processedCount = 0;
			let operationId = '';

			const result = await batch.executeBatch('copy', entries, '/dest', async () => {
				processedCount++;
				if (processedCount === 1) {
					// Get the operation store ID and cancel via the store (simulates OperationTracker button)
					const ops = Array.from(operationsStore.operations.values());
					operationId = ops[0].id;
					await operationsStore.cancelOperation(operationId);
				}
			});

			expect(result).not.toBeNull();
			expect(result!.status).toBe('cancelled');
			expect(result!.results.successful).toBe(1);
			expect(result!.results.skipped).toBeGreaterThan(0);
			// Total should match entries length
			expect(result!.results.successful + result!.results.failed + result!.results.skipped).toBe(4);
		});

		it('cancel callback should be unregistered after batch completes normally', async () => {
			const batch = useBatchOperations();
			const operationsStore = useOperationsStore();
			const entries = [createMockEntry('a.txt')];

			await batch.executeBatch('copy', entries, '/dest', async () => {});

			// After completion, cancelOperation should not trigger any callback
			const ops = Array.from(operationsStore.operations.values());
			// Operation is already completed, cancelOperation should do nothing
			await operationsStore.cancelOperation(ops[0].id);
			// Should not throw or cause issues
		});
	});
});
