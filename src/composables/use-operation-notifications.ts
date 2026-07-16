import { invoke } from '@tauri-apps/api/core';
import { markRaw, watch } from 'vue';
import OperationCompletedToast from '@/components/ui/toast/OperationCompletedToast.vue';
import CustomSimple from '@/components/ui/toast/CustomSimple.vue';
import { toast } from '@/components/ui/toast/toaster';
import {
	useOperationsStore,
	type FileOperation,
} from '@/stores/runtime/operations';
import { useWorkspacesStore } from '@/stores/storage/workspaces';

const AUTO_DISMISS_DURATION = 5000;

/**
 * Composable that watches for operation completions in the operations store
 * and shows toast notifications with navigation support.
 *
 * Requirements:
 * - 8.5: Success notification with auto-dismiss at 5s
 * - 8.6: Partial failure summary (exitosos, fallidos, omitidos)
 * - 8.7: Click notification to navigate to destination directory
 * - 8.8: Error if destination directory no longer exists
 */
export function useOperationNotifications() {
	const operationsStore = useOperationsStore();
	const workspacesStore = useWorkspacesStore();

	// Track operations we've already notified about to avoid duplicates
	const notifiedOperations = new Set<string>();

	/**
	 * Navigate to the destination directory of a completed operation.
	 * Shows an error toast if the directory no longer exists.
	 */
	async function navigateToDestination(destinationPath: string, toastId: string | number): Promise<void> {
		try {
			// Verify destination directory still exists (Requirement 8.8)
			await invoke('read_dir', { path: destinationPath });

			// Dismiss the notification toast
			toast.dismiss(toastId);

			// Navigate to the destination (Requirement 8.7)
			await workspacesStore.openNewTabGroup(destinationPath);
		} catch {
			// Destination no longer exists (Requirement 8.8)
			toast.dismiss(toastId);
			toast.custom(markRaw(CustomSimple), {
				componentProps: {
					title: 'El directorio destino no se encuentra disponible',
					description: destinationPath,
				},
				duration: 5000,
			});
		}
	}

	/**
	 * Show a success notification for a completed operation.
	 */
	function showSuccessNotification(operation: FileOperation): void {
		let toastId: string | number = '';

		const handleClick = operation.destinationPath
			? () => navigateToDestination(operation.destinationPath!, toastId)
			: undefined;

		toastId = toast.custom(markRaw(OperationCompletedToast), {
			componentProps: {
				operationType: operation.type,
				destinationPath: operation.destinationPath,
				isPartialFailure: false,
				onClick: handleClick,
			},
			duration: AUTO_DISMISS_DURATION,
		});
	}

	/**
	 * Show a partial failure notification with summary counts.
	 */
	function showPartialFailureNotification(operation: FileOperation): void {
		let toastId: string | number = '';

		const handleClick = operation.destinationPath
			? () => navigateToDestination(operation.destinationPath!, toastId)
			: undefined;

		const error = operation.error;

		toastId = toast.custom(markRaw(OperationCompletedToast), {
			componentProps: {
				operationType: operation.type,
				destinationPath: operation.destinationPath,
				successCount: error?.successfulFiles ?? 0,
				failedCount: error?.failedFiles ?? 0,
				skippedCount: error?.skippedFiles ?? 0,
				isPartialFailure: true,
				onClick: handleClick,
			},
			duration: AUTO_DISMISS_DURATION,
		});
	}

	/**
	 * Show a cancellation notification with processed/pending counts.
	 * Requirement 11.5: Report "X files processed, Y files pending (cancelled)"
	 */
	function showCancellationNotification(operation: FileOperation): void {
		const error = operation.error;
		toast.custom(markRaw(OperationCompletedToast), {
			componentProps: {
				operationType: operation.type,
				destinationPath: operation.destinationPath,
				successCount: error?.successfulFiles ?? 0,
				failedCount: error?.failedFiles ?? 0,
				skippedCount: error?.skippedFiles ?? 0,
				isPartialFailure: true,
				isCancelled: true,
			},
			duration: AUTO_DISMISS_DURATION,
		});
	}

	/**
	 * Handle an operation that just completed or failed.
	 */
	function handleOperationComplete(operation: FileOperation): void {
		if (notifiedOperations.has(operation.id)) return;
		notifiedOperations.add(operation.id);

		if (operation.status === 'cancelled') {
			// Cancelled batch — show processed/pending summary (Req 11.5)
			if (operation.error) {
				showCancellationNotification(operation);
			}
		} else if (operation.status === 'completed') {
			// Check if it's a partial failure (has error with failed/skipped files)
			if (
				operation.error &&
				(operation.error.failedFiles > 0 || operation.error.skippedFiles > 0)
			) {
				showPartialFailureNotification(operation);
			} else {
				showSuccessNotification(operation);
			}
		} else if (operation.status === 'failed' && operation.error) {
			// Operation failed entirely but has partial results
			if (operation.error.successfulFiles > 0) {
				showPartialFailureNotification(operation);
			}
		}
	}

	// Watch all operations for status changes
	watch(
		() => operationsStore.allOperations,
		(operations) => {
			for (const op of operations) {
				if (
					(op.status === 'completed' || op.status === 'failed' || op.status === 'cancelled') &&
					!notifiedOperations.has(op.id)
				) {
					handleOperationComplete(op);
				}
			}
		},
		{ deep: true }
	);

	return {
		notifiedOperations,
	};
}
