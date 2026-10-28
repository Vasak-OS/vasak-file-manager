import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type OperationType, useStatusCenterStore } from '@/stores/runtime/status-center';
import { formatBytes } from '@/utils/byte-parser';

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
	// En copias, el avance real por bytes; el backend los manda en 0 para mover y
	// borrar (y entonces el porcentaje cae al conteo de archivos).
	processed_bytes: number;
	total_bytes: number;
	bytes_per_second: number;
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
		// Por bytes cuando el backend los conoce (copias): en pocos archivos
		// grandes la barra ya no salta de golpe. Si no (mover, borrar), por conteo.
		// `min(100)`: con symlinks dentro de un origen, `total_bytes` (que no los
		// sigue) puede quedar corto y los bytes copiados pasarlo; la barra no se va
		// de 100%. El evento final forzado la deja en 100 igual.
		const pct =
			payload.total_bytes > 0
				? Math.min(100, Math.round((payload.processed_bytes / payload.total_bytes) * 100))
				: payload.total > 0
					? Math.round((payload.processed / payload.total) * 100)
					: 0;
		const name = payload.current ? payload.current.split('/').filter(Boolean).pop() : undefined;
		// La velocidad es número + unidad, sin palabras que traducir.
		const speed =
			payload.bytes_per_second > 0 ? `${formatBytes(payload.bytes_per_second)}/s` : undefined;
		const message = [name, speed].filter(Boolean).join(' · ') || undefined;
		statusCenter.updateOperation(operationId, { progress: pct, message });
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
