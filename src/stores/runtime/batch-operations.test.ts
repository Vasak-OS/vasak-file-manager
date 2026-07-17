import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useBatchOperationsStore } from './batch-operations';

describe('useBatchOperationsStore', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	describe('registerBatch', () => {
		it('should register a new batch with initial state', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 10, 'op-1');

			const batch = store.getBatch('batch-1');
			expect(batch).not.toBeNull();
			expect(batch!.id).toBe('batch-1');
			expect(batch!.totalFiles).toBe(10);
			expect(batch!.processedFiles).toBe(0);
			expect(batch!.failedFiles).toBe(0);
			expect(batch!.skippedFiles).toBe(0);
			expect(batch!.isCancelled).toBe(false);
			expect(batch!.errors).toHaveLength(0);
			expect(batch!.operationStoreId).toBe('op-1');
		});

		it('should return null for unregistered batch', () => {
			const store = useBatchOperationsStore();
			expect(store.getBatch('nonexistent')).toBeNull();
		});
	});

	describe('cancelBatch (Req 11.5)', () => {
		it('should set isCancelled flag to true', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 5, 'op-1');

			expect(store.isCancelled('batch-1')).toBe(false);
			store.cancelBatch('batch-1');
			expect(store.isCancelled('batch-1')).toBe(true);
		});

		it('should not throw for unknown batch ID', () => {
			const store = useBatchOperationsStore();
			expect(() => store.cancelBatch('unknown')).not.toThrow();
			expect(store.isCancelled('unknown')).toBe(false);
		});
	});

	describe('recordSuccess', () => {
		it('should increment processedFiles count', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 5, null);

			store.recordSuccess('batch-1');
			store.recordSuccess('batch-1');

			const batch = store.getBatch('batch-1');
			expect(batch!.processedFiles).toBe(2);
		});
	});

	describe('recordFailure (Req 11.6)', () => {
		it('should increment failedFiles and accumulate error details', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 5, null);

			store.recordFailure('batch-1', '/home/user/secret.txt', 'Permission denied');
			store.recordFailure('batch-1', '/mnt/usb/data.bin', 'File is locked');

			const batch = store.getBatch('batch-1');
			expect(batch!.failedFiles).toBe(2);
			expect(batch!.errors).toHaveLength(2);
			expect(batch!.errors[0]).toEqual({ path: '/home/user/secret.txt', error: 'Permission denied' });
			expect(batch!.errors[1]).toEqual({ path: '/mnt/usb/data.bin', error: 'File is locked' });
		});
	});

	describe('recordSkipped', () => {
		it('should add skipped count for pending files on cancellation', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 10, null);

			store.recordSuccess('batch-1');
			store.recordSuccess('batch-1');
			store.recordSuccess('batch-1');
			store.cancelBatch('batch-1');
			store.recordSkipped('batch-1', 7);

			const batch = store.getBatch('batch-1');
			expect(batch!.processedFiles).toBe(3);
			expect(batch!.skippedFiles).toBe(7);
			expect(batch!.isCancelled).toBe(true);
		});
	});

	describe('getSummary (Req 11.6)', () => {
		it('should return correct summary after mixed results', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 8, null);

			store.recordSuccess('batch-1');
			store.recordSuccess('batch-1');
			store.recordSuccess('batch-1');
			store.recordFailure('batch-1', '/a.txt', 'Permission denied');
			store.recordFailure('batch-1', '/b.txt', 'Disk full');
			store.recordSuccess('batch-1');
			store.recordSuccess('batch-1');
			store.recordSuccess('batch-1');

			const summary = store.getSummary('batch-1');
			expect(summary).not.toBeNull();
			expect(summary!.successful).toBe(6);
			expect(summary!.failed).toBe(2);
			expect(summary!.skipped).toBe(0);
			expect(summary!.total).toBe(8);
			expect(summary!.isCancelled).toBe(false);
			expect(summary!.errors).toHaveLength(2);
		});

		it('should return null for unknown batch', () => {
			const store = useBatchOperationsStore();
			expect(store.getSummary('unknown')).toBeNull();
		});

		it('should report cancelled summary correctly', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 10, null);

			store.recordSuccess('batch-1');
			store.recordSuccess('batch-1');
			store.recordFailure('batch-1', '/x.txt', 'Error');
			store.cancelBatch('batch-1');
			store.recordSkipped('batch-1', 7);

			const summary = store.getSummary('batch-1');
			expect(summary!.successful).toBe(2);
			expect(summary!.failed).toBe(1);
			expect(summary!.skipped).toBe(7);
			expect(summary!.isCancelled).toBe(true);
			// successful + failed + skipped = total
			expect(summary!.successful + summary!.failed + summary!.skipped).toBe(10);
		});
	});

	describe('getCancellationReport (Req 11.5)', () => {
		it('should return formatted message for cancelled batch', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 10, null);

			store.recordSuccess('batch-1');
			store.recordSuccess('batch-1');
			store.recordSuccess('batch-1');
			store.cancelBatch('batch-1');

			const report = store.getCancellationReport('batch-1');
			expect(report).toBe('3 of 10 files processed, 7 pending (cancelled)');
		});

		it('should return null for non-cancelled batch', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 5, null);
			store.recordSuccess('batch-1');

			expect(store.getCancellationReport('batch-1')).toBeNull();
		});

		it('should return null for unknown batch', () => {
			const store = useBatchOperationsStore();
			expect(store.getCancellationReport('unknown')).toBeNull();
		});

		it('should account for failed files in pending count', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 10, null);

			store.recordSuccess('batch-1');
			store.recordFailure('batch-1', '/a.txt', 'Error');
			store.recordSuccess('batch-1');
			store.cancelBatch('batch-1');

			const report = store.getCancellationReport('batch-1');
			// 2 processed, 1 failed, so pending = 10 - 2 - 1 = 7
			expect(report).toBe('2 of 10 files processed, 7 pending (cancelled)');
		});
	});

	describe('activeBatches', () => {
		it('should include only non-cancelled, non-completed batches', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('active-1', 5, null);
			store.registerBatch('cancelled-1', 5, null);
			store.registerBatch('done-1', 2, null);

			store.cancelBatch('cancelled-1');
			store.recordSuccess('done-1');
			store.recordSuccess('done-1');

			expect(store.activeBatches).toHaveLength(1);
			expect(store.activeBatches[0].id).toBe('active-1');
		});
	});

	describe('removeBatch', () => {
		it('should remove batch from tracking', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 5, null);

			store.removeBatch('batch-1');
			expect(store.getBatch('batch-1')).toBeNull();
		});
	});

	describe('clearAll', () => {
		it('should remove all batches', () => {
			const store = useBatchOperationsStore();
			store.registerBatch('batch-1', 5, null);
			store.registerBatch('batch-2', 3, null);

			store.clearAll();
			expect(store.getBatch('batch-1')).toBeNull();
			expect(store.getBatch('batch-2')).toBeNull();
		});
	});
});
