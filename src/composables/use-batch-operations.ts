import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ref, type Ref } from 'vue';
import { useOperationsStore, type FileOperationType } from '@/stores/runtime/operations';
import { useBatchOperationsStore } from '@/stores/runtime/batch-operations';
import type { DirEntry } from '@/types/dir-entry';

export type BatchOperationType = 'copy' | 'move' | 'delete' | 'compress' | 'changePermissions';

export type BatchOperationStatus =
	| 'idle'
	| 'confirming'
	| 'in-progress'
	| 'completed'
	| 'cancelled'
	| 'partial-failure';

export type ConflictResolution = 'skip' | 'overwrite' | 'rename' | 'ask-each';

export type ConflictResolutionChoice = 'skip' | 'overwrite' | 'rename';

export interface BatchConflict {
	sourceName: string;
	sourcePath: string;
	destinationPath: string;
}

export interface FailedPath {
	path: string;
	error: string;
}

export interface BatchOperationResult {
	successful: number;
	failed: number;
	skipped: number;
	failedPaths: FailedPath[];
}

export interface BatchOperationState {
	id: string;
	operationStoreId: string | null;
	type: FileOperationType;
	entries: DirEntry[];
	destination?: string;
	status: BatchOperationStatus;
	conflictResolution?: ConflictResolution;
	results: BatchOperationResult;
}

export interface BatchProgress {
	totalFiles: number;
	completedFiles: number;
	currentFile: string;
	currentFileProgress: number; // 0-100 percentage of bytes for current file
}

export type FileProcessor = (entry: DirEntry) => Promise<void>;

/**
 * Maximum number of entries for a batch operation (Requirement 11.2).
 */
export const MAX_BATCH_ENTRIES = 10000;

/**
 * Whether an operation type is considered destructive (requires confirmation for ≥2 entries).
 * Destructive operations: delete, move (Requirement 11.1).
 */
export function isDestructiveOperation(type: BatchOperationType): boolean {
	return type === 'delete' || type === 'move';
}

/**
 * Maps batch operation type to the operations store FileOperationType.
 */
export function toFileOperationType(type: BatchOperationType): FileOperationType {
	switch (type) {
		case 'copy':
			return 'copy';
		case 'move':
			return 'move';
		case 'delete':
			return 'delete';
		case 'compress':
			return 'compress';
		case 'changePermissions':
			return 'copy'; // closest match for tracking purposes
	}
}

/**
 * Maps the UI conflict resolution choice to the backend's expected format.
 */
export function mapResolutionToBackend(choice: ConflictResolutionChoice): string {
	switch (choice) {
		case 'skip':
			return 'skip';
		case 'overwrite':
			return 'replace';
		case 'rename':
			return 'auto-rename';
	}
}


/**
 * Composable for managing batch file operations with confirmation dialogs,
 * conflict resolution, progress tracking, cancellation and error isolation.
 *
 * Requirements:
 * - 11.1: Confirmation dialog for destructive operations with ≥2 entries
 * - 11.2: Support copy, move, delete, changePermissions, compress up to 10,000 entries
 * - 11.3: Conflict dialog with skip, overwrite, rename (individual or apply-to-all)
 * - 11.4: Global progress (X/Y files) and per-file progress (% bytes)
 * - 11.5: Preserve processed files on cancel, report processed/pending counts
 * - 11.6: Continue batch on individual failure, report summary at end
 */
export function useBatchOperations() {
	const operationsStore = useOperationsStore();

	// --- Confirmation dialog state (Req 11.1) ---
	const showConfirmDialog = ref(false);
	const confirmDialogType = ref<BatchOperationType>('copy');
	const confirmDialogEntries = ref<DirEntry[]>([]);
	const confirmDialogDestination = ref<string | undefined>(undefined);

	// --- Conflict dialog state (Req 11.3) ---
	const showConflictDialog = ref(false);
	const currentConflict = ref<BatchConflict | null>(null);

	// --- Progress state (Req 11.4) ---
	const batchProgress = ref<BatchProgress>({
		totalFiles: 0,
		completedFiles: 0,
		currentFile: '',
		currentFileProgress: 0,
	});
	const isBatchInProgress = ref(false);

	// --- Internal state ---
	const cancellationFlags = new Map<string, Ref<boolean>>();
	let batchCounter = 0;
	let confirmResolve: ((value: boolean) => void) | null = null;
	let conflictResolve: ((value: { choice: ConflictResolutionChoice; applyToAll: boolean }) => void) | null = null;
	let applyToAllResolution: ConflictResolutionChoice | null = null;

	function generateBatchId(): string {
		batchCounter++;
		return `batch-${Date.now()}-${batchCounter}`;
	}

	// --- Confirmation dialog handlers (Req 11.1) ---

	/**
	 * Called by BatchConfirmDialog when user confirms.
	 */
	function handleConfirm(): void {
		showConfirmDialog.value = false;
		confirmResolve?.(true);
		confirmResolve = null;
	}

	/**
	 * Called by BatchConfirmDialog when user cancels.
	 */
	function handleConfirmCancel(): void {
		showConfirmDialog.value = false;
		confirmResolve?.(false);
		confirmResolve = null;
	}

	/**
	 * Shows confirmation dialog and returns a promise that resolves
	 * when the user confirms or cancels.
	 */
	function requestConfirmation(
		type: BatchOperationType,
		entries: DirEntry[],
		destination?: string,
	): Promise<boolean> {
		confirmDialogType.value = type;
		confirmDialogEntries.value = entries;
		confirmDialogDestination.value = destination;
		showConfirmDialog.value = true;

		return new Promise<boolean>((resolve) => {
			confirmResolve = resolve;
		});
	}

	// --- Conflict dialog handlers (Req 11.3) ---

	/**
	 * Called by BatchConflictDialog when user makes a choice.
	 */
	function handleConflictResolution(choice: ConflictResolutionChoice, applyToAll: boolean): void {
		showConflictDialog.value = false;
		conflictResolve?.({ choice, applyToAll });
		conflictResolve = null;
	}

	/**
	 * Called by BatchConflictDialog when user cancels (treated as skip).
	 */
	function handleConflictCancel(): void {
		showConflictDialog.value = false;
		conflictResolve?.({ choice: 'skip', applyToAll: false });
		conflictResolve = null;
	}

	/**
	 * Shows the conflict resolution dialog for a single file conflict.
	 * Returns the user's choice and whether to apply to all remaining.
	 */
	function requestConflictResolution(
		conflict: BatchConflict,
	): Promise<{ choice: ConflictResolutionChoice; applyToAll: boolean }> {
		currentConflict.value = conflict;
		showConflictDialog.value = true;

		return new Promise((resolve) => {
			conflictResolve = resolve;
		});
	}

	/**
	 * Checks for conflicts at the destination and resolves them.
	 * Uses apply-to-all if previously set, otherwise shows dialog.
	 * Returns the backend conflict resolution string or null if no conflicts.
	 */
	async function resolveConflicts(
		sourcePaths: string[],
		destinationPath: string,
	): Promise<string | null> {
		// Check conflicts via backend
		let conflicts: BatchConflict[] = [];
		try {
			const raw = await invoke<Array<{
				source_path: string;
				source_name: string;
				destination_path: string;
			}>>('check_conflicts', { sourcePaths, destinationPath });
			conflicts = raw.map((c) => ({
				sourcePath: c.source_path,
				sourceName: c.source_name,
				destinationPath: c.destination_path,
			}));
		} catch {
			return null;
		}

		if (conflicts.length === 0) return null;

		// If we have a previous apply-to-all resolution, use it
		if (applyToAllResolution) {
			return mapResolutionToBackend(applyToAllResolution);
		}

		// Show conflict dialog for the first conflict
		const { choice, applyToAll } = await requestConflictResolution(conflicts[0]);

		if (applyToAll) {
			applyToAllResolution = choice;
		}

		return mapResolutionToBackend(choice);
	}

	// --- Cancellation ---

	/**
	 * Request cancellation of an in-progress batch operation.
	 */
	function cancelBatch(batchId: string): void {
		const flag = cancellationFlags.get(batchId);
		if (flag) {
			flag.value = true;
		}
	}

	/**
	 * Check if a batch operation has been cancelled.
	 */
	function isBatchCancelled(batchId: string): boolean {
		return cancellationFlags.get(batchId)?.value ?? false;
	}

	/**
	 * Cancel all currently active batch operations.
	 * Called by the OperationTracker cancel button.
	 */
	function cancelCurrentBatch(): void {
		for (const [id] of cancellationFlags) {
			cancelBatch(id);
		}
	}

	// --- Main execution ---

	/**
	 * High-level batch execution with confirmation dialog support.
	 * Shows confirmation for destructive operations with ≥2 entries (Req 11.1).
	 * Enforces 10,000 entry limit (Req 11.2).
	 *
	 * @param type - Batch operation type
	 * @param entries - Array of entries to operate on
	 * @param destination - Target directory path (for copy, move, compress)
	 * @param processor - Optional custom async processor for each entry (defaults to Tauri invoke)
	 * @returns BatchOperationState or null if user cancelled confirmation
	 */
	async function executeBatch(
		type: BatchOperationType,
		entries: DirEntry[],
		destination?: string,
		processor?: FileProcessor,
	): Promise<BatchOperationState | null> {
		// Enforce 10,000 entry limit (Requirement 11.2)
		const limitedEntries = entries.slice(0, MAX_BATCH_ENTRIES);

		// Show confirmation for destructive operations with ≥2 entries (Req 11.1)
		if (isDestructiveOperation(type) && limitedEntries.length >= 2) {
			const confirmed = await requestConfirmation(type, limitedEntries, destination);
			if (!confirmed) {
				return null;
			}
		}

		// Reset apply-to-all for this batch
		applyToAllResolution = null;

		// Execute the batch
		return await runBatch(type, limitedEntries, destination, processor);
	}

	/**
	 * Core batch execution logic with cancellation support and error isolation.
	 * Tracks progress globally (X/Y files) and per file (Req 11.4).
	 * Uses the batch-operations store for per-batch state tracking (Req 11.5, 11.6).
	 */
	async function runBatch(
		type: BatchOperationType,
		entries: DirEntry[],
		destination?: string,
		processor?: FileProcessor,
	): Promise<BatchOperationState> {
		const batchStore = useBatchOperationsStore();
		const batchId = generateBatchId();
		const cancelFlag = ref(false);
		cancellationFlags.set(batchId, cancelFlag);
		isBatchInProgress.value = true;

		const fileOpType = toFileOperationType(type);

		// Register with the operations store for UI tracking
		const operationStoreId = operationsStore.startOperation({
			type: fileOpType,
			sourcePaths: entries.map((e) => e.path),
			destinationPath: destination,
		});

		// Register batch in the batch-operations store for per-batch state tracking
		batchStore.registerBatch(batchId, entries.length, operationStoreId);

		// Register cancellation callback so OperationTracker's cancel button
		// triggers the batch's internal cancellation flag (Req 11.5 integration)
		operationsStore.registerCancelCallback(operationStoreId, () => {
			cancelFlag.value = true;
			batchStore.cancelBatch(batchId);
		});

		// Initialize progress (Req 11.4)
		batchProgress.value = {
			totalFiles: entries.length,
			completedFiles: 0,
			currentFile: '',
			currentFileProgress: 0,
		};

		operationsStore.updateProgress(operationStoreId, {
			totalFiles: entries.length,
			completedFiles: 0,
			currentFile: '',
		});

		const state: BatchOperationState = {
			id: batchId,
			operationStoreId,
			type: fileOpType,
			entries,
			destination,
			status: 'in-progress',
			results: {
				successful: 0,
				failed: 0,
				skipped: 0,
				failedPaths: [],
			},
		};

		// Listen for per-file byte-level progress events from backend (Req 11.4)
		const unlisten = await listen<{
			operation_id: string;
			current_file: string;
			progress_percent: number;
		}>('batch-operation-progress', (event) => {
			if (event.payload.operation_id === operationStoreId) {
				batchProgress.value.currentFile = event.payload.current_file;
				batchProgress.value.currentFileProgress = event.payload.progress_percent;
			}
		});

		let successCount = 0;
		let failedCount = 0;
		const failedPaths: FailedPath[] = [];

		// Default processor invokes Tauri backend for each file
		const processFile: FileProcessor = processor ?? (async (entry: DirEntry) => {
			await invoke('batch_process_file', {
				operationId: operationStoreId,
				type: fileOpType,
				sourcePath: entry.path,
				destinationPath: destination,
			});
		});

		try {
			for (let i = 0; i < entries.length; i++) {
				// Check cancellation flag BEFORE processing each file (Req 11.5)
				if (cancelFlag.value) {
					const pending = entries.length - i;
					state.status = 'cancelled';
					state.results.successful = successCount;
					state.results.failed = failedCount;
					state.results.skipped = pending;
					state.results.failedPaths = failedPaths;

					// Update batch store with skipped count
					batchStore.recordSkipped(batchId, pending);

					operationsStore.unregisterCancelCallback(operationStoreId);
					operationsStore.completeOperation(operationStoreId, 'cancelled', {
						message: batchStore.getCancellationReport(batchId) ??
							`${successCount} of ${entries.length} files processed, ${pending} pending (cancelled)`,
						failedFiles: failedCount,
						successfulFiles: successCount,
						skippedFiles: pending,
					});

					cancellationFlags.delete(batchId);
					isBatchInProgress.value = false;
					return state;
				}

				const entry = entries[i];

				// Update progress tracking (Req 11.4)
				batchProgress.value.currentFile = entry.path;
				batchProgress.value.currentFileProgress = 0;
				operationsStore.updateProgress(operationStoreId, {
					currentFile: entry.path,
				});

				try {
					await processFile(entry);
					successCount++;
					batchStore.recordSuccess(batchId);
				} catch (error) {
					// Log the error and continue (Req 11.6 — error isolation)
					const errorMessage = String(error);
					failedPaths.push({
						path: entry.path,
						error: errorMessage,
					});
					failedCount++;
					batchStore.recordFailure(batchId, entry.path, errorMessage);
					continue;
				}

				// Update global progress (Req 11.4)
				batchProgress.value.completedFiles = successCount + failedCount;
				operationsStore.updateProgress(operationStoreId, {
					completedFiles: successCount + failedCount,
				});
			}
		} finally {
			unlisten();
		}

		// Determine final status
		state.results.successful = successCount;
		state.results.failed = failedCount;
		state.results.skipped = 0;
		state.results.failedPaths = failedPaths;

		// Unregister the cancellation callback since the operation is done
		operationsStore.unregisterCancelCallback(operationStoreId);

		if (failedCount > 0 && successCount > 0) {
			state.status = 'partial-failure';
			operationsStore.completeOperation(operationStoreId, 'completed', {
				message: `${successCount} successful, ${failedCount} failed, 0 skipped`,
				failedFiles: failedCount,
				successfulFiles: successCount,
				skippedFiles: 0,
			});
		} else if (failedCount > 0 && successCount === 0) {
			state.status = 'partial-failure';
			operationsStore.completeOperation(operationStoreId, 'failed', {
				message: `All ${failedCount} files failed`,
				failedFiles: failedCount,
				successfulFiles: 0,
				skippedFiles: 0,
			});
		} else {
			state.status = 'completed';
			operationsStore.completeOperation(operationStoreId, 'completed');
		}

		cancellationFlags.delete(batchId);
		isBatchInProgress.value = false;
		return state;
	}

	return {
		// Confirmation dialog state & handlers
		showConfirmDialog,
		confirmDialogType,
		confirmDialogEntries,
		confirmDialogDestination,
		handleConfirm,
		handleConfirmCancel,

		// Conflict dialog state & handlers
		showConflictDialog,
		currentConflict,
		handleConflictResolution,
		handleConflictCancel,
		resolveConflicts,

		// Progress state
		batchProgress,
		isBatchInProgress,

		// Core actions
		executeBatch,
		cancelBatch,
		cancelCurrentBatch,
		isBatchCancelled,
		cancellationFlags,
	};
}
