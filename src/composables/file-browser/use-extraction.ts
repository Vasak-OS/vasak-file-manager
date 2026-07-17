import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { markRaw, ref } from 'vue';
import CustomSimple from '@/components/ui/toast/CustomSimple.vue';
import { toast } from '@/components/ui/toast/toaster';
import type { ConflictItem, ConflictResolution } from '@/stores/runtime/clipboard';
import { useOperationsStore } from '@/stores/runtime/operations';
import type { DirEntry } from '@/types/dir-entry';

export interface ExtractionProgress {
	currentFile: string;
	completedFiles: number;
	totalFiles: number;
}

export interface ExtractionResult {
	success: boolean;
	error?: string;
	extracted_count?: number;
	failed_count?: number;
	skipped_count?: number;
}

/**
 * Composable for archive extraction operations.
 * Handles "Extract here", "Extract to...", conflict resolution,
 * password-protected archives, and progress tracking via operations store.
 *
 * Requirements: 15.4, 15.5, 15.6, 15.7, 15.8, 15.9
 */
export function useExtraction(
	currentPath: () => string,
	onRefresh: () => void,
	showConflictDialog: (
		conflicts: ConflictItem[],
		operationType: 'copy' | 'move'
	) => Promise<ConflictResolution | null>
) {
	const operationsStore = useOperationsStore();

	const passwordDialogState = ref({
		isOpen: false,
		archivePath: '',
		pendingResolve: null as ((password: string | null) => void) | null,
	});

	/**
	 * Prompt for password via a dialog.
	 * Returns the password string or null if cancelled.
	 */
	function promptPassword(archivePath: string): Promise<string | null> {
		return new Promise((resolve) => {
			passwordDialogState.value = {
				isOpen: true,
				archivePath,
				pendingResolve: resolve,
			};
		});
	}

	function handlePasswordSubmit(password: string) {
		if (passwordDialogState.value.pendingResolve) {
			passwordDialogState.value.pendingResolve(password);
			passwordDialogState.value.pendingResolve = null;
		}
		passwordDialogState.value.isOpen = false;
	}

	function handlePasswordCancel() {
		if (passwordDialogState.value.pendingResolve) {
			passwordDialogState.value.pendingResolve(null);
			passwordDialogState.value.pendingResolve = null;
		}
		passwordDialogState.value.isOpen = false;
	}

	/**
	 * Extract archive to a given destination directory.
	 * Handles progress tracking, conflict detection, password prompts, and error handling.
	 */
	async function extractArchive(
		entry: DirEntry,
		destDir: string,
		password?: string
	): Promise<boolean> {
		const operationId = operationsStore.startOperation({
			type: 'decompress',
			sourcePaths: [entry.path],
			destinationPath: destDir,
		});

		let cancelled = false;
		operationsStore.registerCancelCallback(operationId, () => {
			cancelled = true;
		});

		try {
			// Step 1: Check if the archive requires a password
			const needsPassword = await invoke<boolean>('archive_needs_password', {
				archivePath: entry.path,
			}).catch(() => false);

			let effectivePassword: string | undefined = password;
			if (needsPassword && !effectivePassword) {
				const prompted = await promptPassword(entry.path);
				if (prompted === null) {
					// User cancelled password entry
					operationsStore.completeOperation(operationId, 'cancelled');
					operationsStore.unregisterCancelCallback(operationId);
					return false;
				}
				effectivePassword = prompted;
			}

			if (cancelled) {
				operationsStore.completeOperation(operationId, 'cancelled');
				operationsStore.unregisterCancelCallback(operationId);
				return false;
			}

			// Step 2: List archive contents for progress tracking and conflict detection
			const archiveEntries = await invoke<Array<{ name: string; path: string; size: number; is_dir: boolean }>>('list_archive_contents', {
				archivePath: entry.path,
				password: effectivePassword || null,
			});

			const totalFiles = archiveEntries.filter((e) => !e.is_dir).length || archiveEntries.length;
			operationsStore.updateProgress(operationId, {
				totalFiles,
				completedFiles: 0,
				currentFile: '',
			});

			if (cancelled) {
				operationsStore.completeOperation(operationId, 'cancelled');
				operationsStore.unregisterCancelCallback(operationId);
				return false;
			}

			// Step 3: Check for conflicts with existing files
			const conflicts = await invoke<ConflictItem[]>('check_extraction_conflicts', {
				archivePath: entry.path,
				destDir,
				password: effectivePassword || null,
			}).catch(() => [] as ConflictItem[]);

			let conflictResolution: ConflictResolution | undefined;
			if (conflicts.length > 0) {
				const resolution = await showConflictDialog(conflicts, 'copy');
				if (resolution === null) {
					operationsStore.completeOperation(operationId, 'cancelled');
					operationsStore.unregisterCancelCallback(operationId);
					return false;
				}
				conflictResolution = resolution;
			}

			if (cancelled) {
				operationsStore.completeOperation(operationId, 'cancelled');
				operationsStore.unregisterCancelCallback(operationId);
				return false;
			}

			// Step 4: Perform extraction
			const result = await invoke<ExtractionResult>('extract_archive', {
				archivePath: entry.path,
				destDir,
				password: effectivePassword || null,
				conflictResolution: conflictResolution || null,
			});

			if (result.success) {
				operationsStore.updateProgress(operationId, {
					completedFiles: totalFiles,
					totalFiles,
					currentFile: '',
				});
				operationsStore.completeOperation(operationId, 'completed');
				operationsStore.unregisterCancelCallback(operationId);

				toast.custom(markRaw(CustomSimple), {
					componentProps: {
						title: 'notifications.archiveExtracted',
						description: '',
					},
				});

				onRefresh();
				return true;
			}

			// Extraction failed - Requirement 15.8: preserve originals, show error
			operationsStore.completeOperation(operationId, 'failed', {
				message: result.error || 'Unknown error',
				failedFiles: result.failed_count ?? 0,
				successfulFiles: result.extracted_count ?? 0,
				skippedFiles: result.skipped_count ?? 0,
			});
			operationsStore.unregisterCancelCallback(operationId);

			toast.custom(markRaw(CustomSimple), {
				componentProps: {
					title: 'notifications.archiveExtractFailed',
					description: result.error || '',
				},
			});

			return false;
		} catch (error) {
			const errorMessage = String(error);

			// Check if the error indicates a password is needed (Requirement 15.9)
			if (
				errorMessage.includes('password') ||
				errorMessage.includes('encrypted') ||
				errorMessage.includes('contraseña')
			) {
				operationsStore.completeOperation(operationId, 'failed', {
					message: errorMessage,
					failedFiles: 0,
					successfulFiles: 0,
					skippedFiles: 0,
				});
				operationsStore.unregisterCancelCallback(operationId);

				// Retry with password
				const pw = await promptPassword(entry.path);
				if (pw !== null) {
					return extractArchive(entry, destDir, pw);
				}
				return false;
			}

			// Generic error - Requirement 15.8: preserve originals, show error
			operationsStore.completeOperation(operationId, 'failed', {
				message: errorMessage,
				failedFiles: 0,
				successfulFiles: 0,
				skippedFiles: 0,
			});
			operationsStore.unregisterCancelCallback(operationId);

			toast.custom(markRaw(CustomSimple), {
				componentProps: {
					title: 'notifications.archiveExtractFailed',
					description: errorMessage,
				},
			});

			return false;
		}
	}

	/**
	 * "Extraer aquí" — Extract to current directory (Requirement 15.4)
	 */
	async function extractHere(entry: DirEntry): Promise<boolean> {
		return extractArchive(entry, currentPath());
	}

	/**
	 * "Extraer en..." — Open directory selection dialog, then extract (Requirement 15.5)
	 */
	async function extractTo(entry: DirEntry): Promise<boolean> {
		const selectedDir = await openDialog({
			directory: true,
			multiple: false,
			title: 'Select destination directory',
			defaultPath: currentPath(),
		});

		if (!selectedDir) {
			return false;
		}

		const destDir = typeof selectedDir === 'string' ? selectedDir : selectedDir;
		return extractArchive(entry, destDir);
	}

	return {
		extractHere,
		extractTo,
		extractArchive,
		passwordDialogState,
		handlePasswordSubmit,
		handlePasswordCancel,
	};
}
