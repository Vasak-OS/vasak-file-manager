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

export interface CompressResult {
	success: boolean;
	error?: string;
	archive_path?: string;
	cancelled?: boolean;
}

interface FileOperationProgress {
	operation_id: string;
	kind: string;
	processed: number;
	total: number;
	current: string;
}

interface OperationMeta {
	type: OperationType;
	label: string;
	path: string;
}

/**
 * Runs a backend command while tracking it in the status center: registers the
 * operation, follows `file-operation-progress` events, and settles the final
 * status. The generated `operationId` doubles as the cancellation handle (see
 * {@link cancelFileOperation}).
 */
async function track<T extends { success: boolean; error?: string }>(
	command: string,
	args: Record<string, unknown>,
	meta: OperationMeta,
	onFailure: (result: T) => string | undefined
): Promise<T> {
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
		const result = await invoke<T>(command, { ...args, operationId });

		const existing = statusCenter.operations.get(operationId);
		if (existing?.status === 'cancelled') {
			// The user cancelled mid-flight; keep that status.
		} else if (result.success) {
			statusCenter.completeOperation(operationId, 'completed');
		} else {
			statusCenter.completeOperation(operationId, 'error', onFailure(result));
		}

		return result;
	} catch (error) {
		statusCenter.completeOperation(operationId, 'error', String(error));
		throw error;
	} finally {
		unlisten();
	}
}

type TrackedCommand = 'copy_items' | 'move_items' | 'delete_items';

export async function runTrackedFileOperation(
	command: TrackedCommand,
	args: Record<string, unknown>,
	meta: OperationMeta
): Promise<FileOperationResult> {
	try {
		return await track<FileOperationResult>(command, args, meta, (result) => result.error);
	} catch (error) {
		return { success: false, error: String(error) };
	}
}

export async function runTrackedCompress(
	args: Record<string, unknown>,
	meta: OperationMeta
): Promise<CompressResult> {
	try {
		return await track<CompressResult>('compress_items', args, meta, (result) =>
			result.cancelled ? undefined : result.error
		);
	} catch (error) {
		return { success: false, error: String(error) };
	}
}

/** Requests cancellation of an in-flight tracked operation by its id. */
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
