import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Mock tauri API
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: vi.fn(),
}));

vi.mock('@/components/ui/toast/CustomSimple.vue', () => ({ default: {} }));
vi.mock('@/components/ui/toast/toaster', () => ({
	toast: { custom: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useExtraction } from './use-extraction';
import type { DirEntry } from '@/types/dir-entry';
import type { ConflictResolution } from '@/stores/runtime/clipboard';
import { useOperationsStore } from '@/stores/runtime/operations';

const mockInvoke = vi.mocked(invoke);
const mockOpenDialog = vi.mocked(openDialog);

function createMockArchiveEntry(): DirEntry {
	return {
		name: 'test.zip',
		ext: 'zip',
		path: '/home/user/test.zip',
		size: 1024,
		item_count: null,
		modified_time: Date.now(),
		accessed_time: Date.now(),
		created_time: Date.now(),
		mime: 'application/zip',
		is_file: true,
		is_dir: false,
		is_symlink: false,
		is_hidden: false,
	};
}

describe('useExtraction', () => {
	let currentPath: string;
	let onRefresh: ReturnType<typeof vi.fn>;
	let showConflictDialog: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		setActivePinia(createPinia());
		currentPath = '/home/user/documents';
		onRefresh = vi.fn();
		showConflictDialog = vi.fn().mockResolvedValue(null);
		vi.clearAllMocks();
	});

	function createExtraction() {
		return useExtraction(
			() => currentPath,
			onRefresh,
			showConflictDialog as (
				conflicts: any[],
				operationType: 'copy' | 'move'
			) => Promise<ConflictResolution | null>
		);
	}

	describe('extractHere', () => {
		it('should extract archive to current directory with progress tracking', async () => {
			const extraction = createExtraction();
			const entry = createMockArchiveEntry();
			const operationsStore = useOperationsStore();

			mockInvoke.mockImplementation(async (cmd: string) => {
				if (cmd === 'archive_needs_password') return false;
				if (cmd === 'list_archive_contents') {
					return [
						{ name: 'file1.txt', path: 'file1.txt', size: 100, is_dir: false },
						{ name: 'file2.txt', path: 'file2.txt', size: 200, is_dir: false },
					];
				}
				if (cmd === 'check_extraction_conflicts') return [];
				if (cmd === 'extract_archive') {
					return { success: true, extracted_count: 2, failed_count: 0, skipped_count: 0 };
				}
				return null;
			});

			const result = await extraction.extractHere(entry);

			expect(result).toBe(true);
			expect(mockInvoke).toHaveBeenCalledWith('extract_archive', {
				archivePath: '/home/user/test.zip',
				destDir: '/home/user/documents',
				password: null,
				conflictResolution: null,
			});
			expect(onRefresh).toHaveBeenCalled();

			// Operation should be tracked
			const ops = Array.from(operationsStore.operations.values());
			expect(ops.length).toBe(1);
			expect(ops[0].type).toBe('decompress');
			expect(ops[0].status).toBe('completed');
		});

		it('should handle extraction failure and preserve originals (Req 15.8)', async () => {
			const extraction = createExtraction();
			const entry = createMockArchiveEntry();
			const operationsStore = useOperationsStore();

			mockInvoke.mockImplementation(async (cmd: string) => {
				if (cmd === 'archive_needs_password') return false;
				if (cmd === 'list_archive_contents') return [{ name: 'file1.txt', path: 'file1.txt', size: 100, is_dir: false }];
				if (cmd === 'check_extraction_conflicts') return [];
				if (cmd === 'extract_archive') {
					return { success: false, error: 'Permission denied', extracted_count: 0, failed_count: 1, skipped_count: 0 };
				}
				return null;
			});

			const result = await extraction.extractHere(entry);

			expect(result).toBe(false);
			const ops = Array.from(operationsStore.operations.values());
			expect(ops[0].status).toBe('failed');
			expect(ops[0].error?.message).toBe('Permission denied');
			// Original archive is never modified (no delete call)
			expect(mockInvoke).not.toHaveBeenCalledWith('delete_items', expect.anything());
		});

		it('should show conflict dialog when files conflict (Req 15.6)', async () => {
			const extraction = createExtraction();
			const entry = createMockArchiveEntry();
			const conflicts = [
				{
					source_path: '/home/user/test.zip/file1.txt',
					source_name: 'file1.txt',
					source_is_dir: false,
					source_size: 100,
					destination_path: '/home/user/documents/file1.txt',
					destination_is_dir: false,
					destination_size: 50,
				},
			];

			showConflictDialog.mockResolvedValue('replace');

			mockInvoke.mockImplementation(async (cmd: string) => {
				if (cmd === 'archive_needs_password') return false;
				if (cmd === 'list_archive_contents') return [{ name: 'file1.txt', path: 'file1.txt', size: 100, is_dir: false }];
				if (cmd === 'check_extraction_conflicts') return conflicts;
				if (cmd === 'extract_archive') {
					return { success: true, extracted_count: 1, failed_count: 0, skipped_count: 0 };
				}
				return null;
			});

			const result = await extraction.extractHere(entry);

			expect(result).toBe(true);
			expect(showConflictDialog).toHaveBeenCalledWith(conflicts, 'copy');
			expect(mockInvoke).toHaveBeenCalledWith('extract_archive', {
				archivePath: '/home/user/test.zip',
				destDir: '/home/user/documents',
				password: null,
				conflictResolution: 'replace',
			});
		});

		it('should cancel extraction when user cancels conflict dialog', async () => {
			const extraction = createExtraction();
			const entry = createMockArchiveEntry();
			const operationsStore = useOperationsStore();

			showConflictDialog.mockResolvedValue(null);

			mockInvoke.mockImplementation(async (cmd: string) => {
				if (cmd === 'archive_needs_password') return false;
				if (cmd === 'list_archive_contents') return [{ name: 'file1.txt', path: 'file1.txt', size: 100, is_dir: false }];
				if (cmd === 'check_extraction_conflicts') {
					return [{ source_path: 'x', source_name: 'x', source_is_dir: false, source_size: 1, destination_path: 'y', destination_is_dir: false, destination_size: 1 }];
				}
				return null;
			});

			const result = await extraction.extractHere(entry);

			expect(result).toBe(false);
			const ops = Array.from(operationsStore.operations.values());
			expect(ops[0].status).toBe('cancelled');
			expect(mockInvoke).not.toHaveBeenCalledWith('extract_archive', expect.anything());
		});
	});

	describe('extractTo', () => {
		it('should open directory dialog and extract to selected destination (Req 15.5)', async () => {
			const extraction = createExtraction();
			const entry = createMockArchiveEntry();

			mockOpenDialog.mockResolvedValue('/home/user/target');
			mockInvoke.mockImplementation(async (cmd: string) => {
				if (cmd === 'archive_needs_password') return false;
				if (cmd === 'list_archive_contents') return [{ name: 'f.txt', path: 'f.txt', size: 10, is_dir: false }];
				if (cmd === 'check_extraction_conflicts') return [];
				if (cmd === 'extract_archive') {
					return { success: true, extracted_count: 1, failed_count: 0, skipped_count: 0 };
				}
				return null;
			});

			const result = await extraction.extractTo(entry);

			expect(result).toBe(true);
			expect(mockOpenDialog).toHaveBeenCalledWith({
				directory: true,
				multiple: false,
				title: 'Select destination directory',
				defaultPath: '/home/user/documents',
			});
			expect(mockInvoke).toHaveBeenCalledWith('extract_archive', {
				archivePath: '/home/user/test.zip',
				destDir: '/home/user/target',
				password: null,
				conflictResolution: null,
			});
		});

		it('should return false when user cancels directory dialog', async () => {
			const extraction = createExtraction();
			const entry = createMockArchiveEntry();

			mockOpenDialog.mockResolvedValue(null);

			const result = await extraction.extractTo(entry);

			expect(result).toBe(false);
			expect(mockInvoke).not.toHaveBeenCalledWith('extract_archive', expect.anything());
		});
	});

	describe('password handling (Req 15.9)', () => {
		it('should prompt for password when archive needs it', async () => {
			const extraction = createExtraction();
			const entry = createMockArchiveEntry();

			mockInvoke.mockImplementation(async (cmd: string) => {
				if (cmd === 'archive_needs_password') return true;
				if (cmd === 'list_archive_contents') return [{ name: 'f.txt', path: 'f.txt', size: 10, is_dir: false }];
				if (cmd === 'check_extraction_conflicts') return [];
				if (cmd === 'extract_archive') {
					return { success: true, extracted_count: 1, failed_count: 0, skipped_count: 0 };
				}
				return null;
			});

			// Start extraction (will wait for password)
			const extractionPromise = extraction.extractHere(entry);

			// Simulate user entering password
			await vi.waitFor(() => {
				expect(extraction.passwordDialogState.value.isOpen).toBe(true);
			});

			extraction.handlePasswordSubmit('secret123');

			const result = await extractionPromise;

			expect(result).toBe(true);
			expect(mockInvoke).toHaveBeenCalledWith('extract_archive', {
				archivePath: '/home/user/test.zip',
				destDir: '/home/user/documents',
				password: 'secret123',
				conflictResolution: null,
			});
		});

		it('should cancel extraction when user cancels password dialog', async () => {
			const extraction = createExtraction();
			const entry = createMockArchiveEntry();
			const operationsStore = useOperationsStore();

			mockInvoke.mockImplementation(async (cmd: string) => {
				if (cmd === 'archive_needs_password') return true;
				return null;
			});

			const extractionPromise = extraction.extractHere(entry);

			await vi.waitFor(() => {
				expect(extraction.passwordDialogState.value.isOpen).toBe(true);
			});

			extraction.handlePasswordCancel();

			const result = await extractionPromise;

			expect(result).toBe(false);
			const ops = Array.from(operationsStore.operations.values());
			expect(ops[0].status).toBe('cancelled');
		});

		it('should retry with password when error indicates encryption', async () => {
			const extraction = createExtraction();
			const entry = createMockArchiveEntry();

			let callCount = 0;
			mockInvoke.mockImplementation(async (cmd: string) => {
				if (cmd === 'archive_needs_password') return false;
				if (cmd === 'list_archive_contents') {
					callCount++;
					if (callCount === 1) {
						throw new Error('Archive is password protected');
					}
					return [{ name: 'f.txt', path: 'f.txt', size: 10, is_dir: false }];
				}
				if (cmd === 'check_extraction_conflicts') return [];
				if (cmd === 'extract_archive') {
					return { success: true, extracted_count: 1, failed_count: 0, skipped_count: 0 };
				}
				return null;
			});

			const extractionPromise = extraction.extractHere(entry);

			// First attempt fails, prompts for password
			await vi.waitFor(() => {
				expect(extraction.passwordDialogState.value.isOpen).toBe(true);
			});

			extraction.handlePasswordSubmit('mypassword');

			const result = await extractionPromise;
			expect(result).toBe(true);
		});
	});

	describe('progress tracking (Req 15.7)', () => {
		it('should track progress with total files and current file', async () => {
			const extraction = createExtraction();
			const entry = createMockArchiveEntry();
			const operationsStore = useOperationsStore();

			mockInvoke.mockImplementation(async (cmd: string) => {
				if (cmd === 'archive_needs_password') return false;
				if (cmd === 'list_archive_contents') {
					return [
						{ name: 'a.txt', path: 'a.txt', size: 100, is_dir: false },
						{ name: 'b.txt', path: 'b.txt', size: 200, is_dir: false },
						{ name: 'subdir', path: 'subdir', size: 0, is_dir: true },
					];
				}
				if (cmd === 'check_extraction_conflicts') return [];
				if (cmd === 'extract_archive') {
					return { success: true, extracted_count: 2, failed_count: 0, skipped_count: 0 };
				}
				return null;
			});

			await extraction.extractHere(entry);

			const ops = Array.from(operationsStore.operations.values());
			// Should track 2 files (excluding directory)
			expect(ops[0].progress.totalFiles).toBe(2);
			expect(ops[0].progress.completedFiles).toBe(2);
		});
	});
});
