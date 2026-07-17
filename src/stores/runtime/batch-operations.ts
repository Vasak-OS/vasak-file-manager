import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';

export interface BatchFailedEntry {
	path: string;
	error: string;
}

export interface BatchState {
	id: string;
	operationStoreId: string | null;
	totalFiles: number;
	processedFiles: number;
	failedFiles: number;
	skippedFiles: number;
	isCancelled: boolean;
	errors: BatchFailedEntry[];
}

export interface BatchSummary {
	successful: number;
	failed: number;
	skipped: number;
	total: number;
	isCancelled: boolean;
	errors: BatchFailedEntry[];
}

/**
 * Pinia store for tracking per-batch operation state.
 * Provides cancellation flags, error accumulation, and progress tracking
 * for each active batch operation.
 *
 * Requirements:
 * - 11.5: Preserve processed files on cancel, report processed/pending
 * - 11.6: Continue batch on individual failure, report summary
 */
export const useBatchOperationsStore = defineStore('batch-operations', () => {
	const batches = reactive(new Map<string, BatchState>());

	/**
	 * All active (non-cancelled, non-completed) batches.
	 */
	const activeBatches = computed<BatchState[]>(() =>
		Array.from(batches.values()).filter(
			(b) => !b.isCancelled && b.processedFiles + b.failedFiles + b.skippedFiles < b.totalFiles,
		),
	);

	/**
	 * Register a new batch operation for tracking.
	 */
	function registerBatch(id: string, totalFiles: number, operationStoreId: string | null): void {
		batches.set(id, {
			id,
			operationStoreId,
			totalFiles,
			processedFiles: 0,
			failedFiles: 0,
			skippedFiles: 0,
			isCancelled: false,
			errors: [],
		});
	}

	/**
	 * Cancel a batch operation by ID. Sets the cancelled flag
	 * which signals the processing loop to stop immediately.
	 * Already processed files are preserved (Req 11.5).
	 */
	function cancelBatch(batchId: string): void {
		const batch = batches.get(batchId);
		if (batch) {
			batch.isCancelled = true;
		}
	}

	/**
	 * Check if a batch has been cancelled.
	 */
	function isCancelled(batchId: string): boolean {
		return batches.get(batchId)?.isCancelled ?? false;
	}

	/**
	 * Record a successful file processing.
	 */
	function recordSuccess(batchId: string): void {
		const batch = batches.get(batchId);
		if (batch) {
			batch.processedFiles++;
		}
	}

	/**
	 * Record a failed file processing with error details (Req 11.6).
	 * The batch continues processing remaining files.
	 */
	function recordFailure(batchId: string, path: string, error: string): void {
		const batch = batches.get(batchId);
		if (batch) {
			batch.failedFiles++;
			batch.errors.push({ path, error });
		}
	}

	/**
	 * Record skipped files (e.g., pending files when batch is cancelled).
	 */
	function recordSkipped(batchId: string, count: number): void {
		const batch = batches.get(batchId);
		if (batch) {
			batch.skippedFiles += count;
		}
	}

	/**
	 * Get the current state of a batch.
	 */
	function getBatch(batchId: string): BatchState | null {
		return batches.get(batchId) ?? null;
	}

	/**
	 * Get a summary of a batch operation's results.
	 * Useful for reporting: "X successful, Y failed, Z skipped" (Req 11.6).
	 */
	function getSummary(batchId: string): BatchSummary | null {
		const batch = batches.get(batchId);
		if (!batch) return null;

		return {
			successful: batch.processedFiles,
			failed: batch.failedFiles,
			skipped: batch.skippedFiles,
			total: batch.totalFiles,
			isCancelled: batch.isCancelled,
			errors: [...batch.errors],
		};
	}

	/**
	 * Get the cancellation report message for a cancelled batch (Req 11.5).
	 * Format: "X files processed, Y files pending (cancelled)"
	 */
	function getCancellationReport(batchId: string): string | null {
		const batch = batches.get(batchId);
		if (!batch || !batch.isCancelled) return null;

		const processed = batch.processedFiles;
		const pending = batch.totalFiles - batch.processedFiles - batch.failedFiles;
		return `${processed} of ${batch.totalFiles} files processed, ${pending} pending (cancelled)`;
	}

	/**
	 * Remove a completed/cancelled batch from tracking.
	 */
	function removeBatch(batchId: string): void {
		batches.delete(batchId);
	}

	/**
	 * Clear all batches.
	 */
	function clearAll(): void {
		batches.clear();
	}

	return {
		batches,
		activeBatches,
		registerBatch,
		cancelBatch,
		isCancelled,
		recordSuccess,
		recordFailure,
		recordSkipped,
		getBatch,
		getSummary,
		getCancellationReport,
		removeBatch,
		clearAll,
	};
});
