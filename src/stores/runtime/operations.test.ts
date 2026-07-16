import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useOperationsStore } from './operations';

describe('operations store', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it('should start with no operations', () => {
		const store = useOperationsStore();
		expect(store.activeOperations).toEqual([]);
		expect(store.allOperations).toEqual([]);
	});

	it('should start an operation and return its id', () => {
		const store = useOperationsStore();
		const id = store.startOperation({
			type: 'copy',
			sourcePaths: ['/home/user/file.txt'],
			destinationPath: '/home/user/backup/',
		});

		expect(id).toBeTruthy();
		expect(store.activeOperations).toHaveLength(1);
		expect(store.activeOperations[0].status).toBe('in-progress');
		expect(store.activeOperations[0].type).toBe('copy');
		expect(store.activeOperations[0].sourcePaths).toEqual(['/home/user/file.txt']);
	});

	it('should initialize progress fields to zero/empty', () => {
		const store = useOperationsStore();
		const id = store.startOperation({
			type: 'move',
			sourcePaths: ['/a/b'],
		});

		const op = store.operations.get(id);
		expect(op?.progress.totalFiles).toBe(0);
		expect(op?.progress.completedFiles).toBe(0);
		expect(op?.progress.totalBytes).toBe(0);
		expect(op?.progress.transferredBytes).toBe(0);
		expect(op?.progress.currentFile).toBe('');
		expect(op?.progress.speed).toBe(0);
		expect(op?.progress.estimatedTimeRemaining).toBe(0);
	});

	it('should update progress for an in-progress operation', () => {
		const store = useOperationsStore();
		const id = store.startOperation({
			type: 'copy',
			sourcePaths: ['/a'],
		});

		store.updateProgress(id, {
			totalFiles: 100,
			completedFiles: 25,
			totalBytes: 1024000,
			transferredBytes: 256000,
			currentFile: '/a/some-file.png',
			speed: 5120000,
			estimatedTimeRemaining: 15,
		});

		const op = store.operations.get(id);
		expect(op?.progress.totalFiles).toBe(100);
		expect(op?.progress.completedFiles).toBe(25);
		expect(op?.progress.currentFile).toBe('/a/some-file.png');
		expect(op?.progress.speed).toBe(5120000);
	});

	it('should not update progress for a completed operation', () => {
		const store = useOperationsStore();
		const id = store.startOperation({
			type: 'delete',
			sourcePaths: ['/a'],
		});

		store.completeOperation(id, 'completed');
		store.updateProgress(id, { completedFiles: 99 });

		const op = store.operations.get(id);
		expect(op?.progress.completedFiles).toBe(0);
	});

	it('should cancel an in-progress operation', async () => {
		const store = useOperationsStore();
		const id = store.startOperation({
			type: 'move',
			sourcePaths: ['/src/dir'],
			destinationPath: '/dest/dir',
		});

		await store.cancelOperation(id);

		const op = store.operations.get(id);
		expect(op?.status).toBe('cancelled');
		expect(op?.completedAt).toBeDefined();
	});

	it('should not cancel an already completed operation', async () => {
		const store = useOperationsStore();
		const id = store.startOperation({
			type: 'copy',
			sourcePaths: ['/a'],
		});

		store.completeOperation(id, 'completed');
		await store.cancelOperation(id);

		const op = store.operations.get(id);
		expect(op?.status).toBe('completed');
	});

	it('should complete an operation with error details', () => {
		const store = useOperationsStore();
		const id = store.startOperation({
			type: 'copy',
			sourcePaths: ['/file1', '/file2', '/file3'],
			destinationPath: '/dest',
		});

		store.completeOperation(id, 'failed', {
			message: 'Permission denied',
			failedFiles: 1,
			successfulFiles: 2,
			skippedFiles: 0,
		});

		const op = store.operations.get(id);
		expect(op?.status).toBe('failed');
		expect(op?.error?.message).toBe('Permission denied');
		expect(op?.error?.failedFiles).toBe(1);
		expect(op?.error?.successfulFiles).toBe(2);
	});

	it('should support multiple simultaneous operations', () => {
		const store = useOperationsStore();

		store.startOperation({ type: 'copy', sourcePaths: ['/a'] });
		store.startOperation({ type: 'move', sourcePaths: ['/b'] });
		store.startOperation({ type: 'delete', sourcePaths: ['/c'] });

		expect(store.activeOperations).toHaveLength(3);
	});

	it('should filter activeOperations to only in-progress status', () => {
		const store = useOperationsStore();

		const id1 = store.startOperation({ type: 'copy', sourcePaths: ['/a'] });
		store.startOperation({ type: 'move', sourcePaths: ['/b'] });

		store.completeOperation(id1, 'completed');

		expect(store.activeOperations).toHaveLength(1);
		expect(store.activeOperations[0].type).toBe('move');
	});

	it('should remove an operation from the map', () => {
		const store = useOperationsStore();
		const id = store.startOperation({ type: 'copy', sourcePaths: ['/a'] });

		store.removeOperation(id);
		expect(store.operations.size).toBe(0);
	});

	it('should clear all completed/cancelled/failed operations', () => {
		const store = useOperationsStore();

		const id1 = store.startOperation({ type: 'copy', sourcePaths: ['/a'] });
		const id2 = store.startOperation({ type: 'move', sourcePaths: ['/b'] });
		store.startOperation({ type: 'delete', sourcePaths: ['/c'] });

		store.completeOperation(id1, 'completed');
		store.completeOperation(id2, 'failed');

		store.clearCompleted();

		expect(store.operations.size).toBe(1);
		expect(store.activeOperations).toHaveLength(1);
	});

	it('should sort allOperations by most recent first', () => {
		const store = useOperationsStore();

		const id1 = store.startOperation({ type: 'copy', sourcePaths: ['/first'] });
		const id2 = store.startOperation({ type: 'move', sourcePaths: ['/second'] });
		const id3 = store.startOperation({ type: 'delete', sourcePaths: ['/third'] });

		// Manually adjust startedAt to simulate time differences
		const op1 = store.operations.get(id1)!;
		const op2 = store.operations.get(id2)!;
		const op3 = store.operations.get(id3)!;
		op1.startedAt = 1000;
		op2.startedAt = 2000;
		op3.startedAt = 3000;

		const ops = store.allOperations;
		expect(ops[0].sourcePaths[0]).toBe('/third');
		expect(ops[1].sourcePaths[0]).toBe('/second');
		expect(ops[2].sourcePaths[0]).toBe('/first');
	});
});
