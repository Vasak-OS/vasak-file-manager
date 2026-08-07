import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useStatusCenterStore, type OperationType } from '@/stores/runtime/status-center';

export interface FileOperationResult {
	success: boolean;
	error?: string;
	copied_count?: number;
	failed_count?: number;
	skipped_count?: number;
}

interface FileOperationProgress {
	operation_id: string;
	kind: string;
	processed: number;
	total: number;
	current: string;
}

type TrackedCommand = 'copy_items' | 'move_items' | 'delete_items';

/**
 * Invokes a copy/move/delete command while tracking it in the status center:
 * registers the operation, listens for `file-operation-progress` events emitted
 * by the backend, updates progress, and marks the final status. The generated
 * `operationId` is used both for progress correlation and for cancellation
 * (see {@link cancelFileOperation}).
 */
export async function runTrackedFileOperation(
	command: TrackedCommand,
	args: Record<string, unknown>,
	meta: { type: OperationType; label: string; path: string }
): Promise<FileOperationResult> {
	const statusCenter = useStatusCenterStore();
	const operationId = `${meta.type}-${crypto.randomUUID()}`;

	statusCenter.addOperation({
		id: operationId,
		type: meta.type,
		status: 'in-progress',
		label: meta.label,
		path: meta.path,
		progress: 0,
	});

	const unlisten = await listen<FileOperationProgress>('file-operation-progress', (event) => {
		const payload = event.payload;
		if (payload.operation_id !== operationId) {
			return;
		}
		const pct = payload.total > 0 ? Math.round((payload.processed / payload.total) * 100) : 0;
		const current = payload.current ? payload.current.split('/').filter(Boolean).pop() : undefined;
		statusCenter.updateOperation(operationId, { progress: pct, message: current });
	});

	try {
		const result = await invoke<FileOperationResult>(command, { ...args, operationId });

		const existing = statusCenter.operations.get(operationId);
		if (existing?.status === 'cancelled') {
			// User cancelled mid-flight; keep the cancelled status.
		} else if (result.success) {
			statusCenter.completeOperation(operationId, 'completed');
		} else {
			statusCenter.completeOperation(operationId, 'error', result.error ?? undefined);
		}

		return result;
	} catch (error) {
		statusCenter.completeOperation(operationId, 'error', String(error));
		return { success: false, error: String(error) };
	} finally {
		unlisten();
	}
}

/** Requests cancellation of an in-flight tracked file operation by its id. */
export async function cancelFileOperation(operationId: string): Promise<boolean> {
	const statusCenter = useStatusCenterStore();
	try {
		const cancelled = await invoke<boolean>('cancel_file_operation', { operationId });
		if (cancelled) {
			statusCenter.completeOperation(operationId, 'cancelled');
		}
		return cancelled;
	} catch (error) {
		console.error('Failed to cancel file operation:', error);
		return false;
	}
}
