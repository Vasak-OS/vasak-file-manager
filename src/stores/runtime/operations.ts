import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';

export type FileOperationType = 'copy' | 'move' | 'delete' | 'compress' | 'decompress';
export type FileOperationStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'cancelled';

export interface OperationProgress {
	totalFiles: number;
	completedFiles: number;
	totalBytes: number;
	transferredBytes: number;
	currentFile: string;
	speed: number; // bytes/s
	estimatedTimeRemaining: number; // seconds
}

export interface OperationError {
	message: string;
	failedFiles: number;
	successfulFiles: number;
	skippedFiles: number;
}

export interface FileOperation {
	id: string;
	type: FileOperationType;
	status: FileOperationStatus;
	sourcePaths: string[];
	destinationPath?: string;
	progress: OperationProgress;
	startedAt: number;
	completedAt?: number;
	error?: OperationError;
}

let operationCounter = 0;

function generateOperationId(): string {
	operationCounter++;
	return `op-${Date.now()}-${operationCounter}`;
}

export const useOperationsStore = defineStore('operations', () => {
	const operations = reactive(new Map<string, FileOperation>());

	/**
	 * Active operations filtered by 'in-progress' status.
	 */
	const activeOperations = computed<FileOperation[]>(() =>
		Array.from(operations.values()).filter((op) => op.status === 'in-progress')
	);

	/**
	 * All operations as an array, sorted by start time (most recent first).
	 */
	const allOperations = computed<FileOperation[]>(() =>
		Array.from(operations.values()).sort((a, b) => b.startedAt - a.startedAt)
	);

	/**
	 * Start a new file operation. Returns the generated operation ID.
	 */
	function startOperation(
		params: Omit<FileOperation, 'id' | 'startedAt' | 'progress' | 'status'>
	): string {
		const id = generateOperationId();
		const operation: FileOperation = {
			id,
			type: params.type,
			status: 'in-progress',
			sourcePaths: params.sourcePaths,
			destinationPath: params.destinationPath,
			progress: {
				totalFiles: 0,
				completedFiles: 0,
				totalBytes: 0,
				transferredBytes: 0,
				currentFile: '',
				speed: 0,
				estimatedTimeRemaining: 0,
			},
			startedAt: Date.now(),
		};
		operations.set(id, operation);
		return id;
	}

	/**
	 * Cancel an in-progress operation immediately.
	 * Preserves files already processed successfully.
	 */
	async function cancelOperation(id: string): Promise<void> {
		const operation = operations.get(id);
		if (operation?.status !== 'in-progress') return;

		operation.status = 'cancelled';
		operation.completedAt = Date.now();
	}

	/**
	 * Update progress for an ongoing operation.
	 */
	function updateProgress(id: string, progress: Partial<OperationProgress>): void {
		const operation = operations.get(id);
		if (operation?.status !== 'in-progress') return;

		Object.assign(operation.progress, progress);
	}

	/**
	 * Mark an operation as completed, failed, or cancelled.
	 */
	function completeOperation(
		id: string,
		result: 'completed' | 'failed' | 'cancelled',
		error?: OperationError
	): void {
		const operation = operations.get(id);
		if (!operation) return;

		operation.status = result;
		operation.completedAt = Date.now();
		if (error) {
			operation.error = error;
		}
	}

	/**
	 * Remove a completed/cancelled/failed operation from the list.
	 */
	function removeOperation(id: string): void {
		operations.delete(id);
	}

	/**
	 * Clear all completed/cancelled/failed operations.
	 */
	function clearCompleted(): void {
		for (const [id, op] of operations) {
			if (op.status === 'completed' || op.status === 'cancelled' || op.status === 'failed') {
				operations.delete(id);
			}
		}
	}

	return {
		operations,
		activeOperations,
		allOperations,
		startOperation,
		cancelOperation,
		updateProgress,
		completeOperation,
		removeOperation,
		clearCompleted,
	};
});
