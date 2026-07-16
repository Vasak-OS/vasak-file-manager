import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useOperationsStore } from '@/stores/runtime/operations';

// Mock Vue components (avoids .vue file parsing)
vi.mock('@/components/ui/toast/OperationCompletedToast.vue', () => ({
	default: { name: 'OperationCompletedToast' },
}));

vi.mock('@/components/ui/toast/CustomSimple.vue', () => ({
	default: { name: 'CustomSimple' },
}));

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
}));

// Mock toast system
const mockToastCustom = vi.fn().mockReturnValue('toast-1');
const mockToastDismiss = vi.fn();

vi.mock('@/components/ui/toast/toaster', () => ({
	toast: {
		custom: (...args: any[]) => mockToastCustom(...args),
		dismiss: (...args: any[]) => mockToastDismiss(...args),
		dismissAll: vi.fn(),
	},
}));

// Mock workspaces store
const mockOpenNewTabGroup = vi.fn();

vi.mock('@/stores/storage/workspaces', () => ({
	useWorkspacesStore: () => ({
		openNewTabGroup: mockOpenNewTabGroup,
	}),
}));

describe('useOperationNotifications', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should show success notification when operation completes (Req 8.5)', async () => {
		const { useOperationNotifications } = await import('./use-operation-notifications');
		const operationsStore = useOperationsStore();

		useOperationNotifications();

		const id = operationsStore.startOperation({
			type: 'copy',
			sourcePaths: ['/home/user/file.txt'],
			destinationPath: '/home/user/backup/',
		});

		operationsStore.completeOperation(id, 'completed');
		await nextTick();

		expect(mockToastCustom).toHaveBeenCalledTimes(1);
		const callArgs = mockToastCustom.mock.calls[0];
		expect(callArgs[1].componentProps.operationType).toBe('copy');
		expect(callArgs[1].componentProps.destinationPath).toBe('/home/user/backup/');
		expect(callArgs[1].componentProps.isPartialFailure).toBe(false);
		expect(callArgs[1].duration).toBe(5000);
	});

	it('should show partial failure notification with summary (Req 8.6)', async () => {
		const { useOperationNotifications } = await import('./use-operation-notifications');
		const operationsStore = useOperationsStore();

		useOperationNotifications();

		const id = operationsStore.startOperation({
			type: 'move',
			sourcePaths: ['/a', '/b', '/c'],
			destinationPath: '/dest/',
		});

		operationsStore.completeOperation(id, 'completed', {
			message: 'Some files failed',
			failedFiles: 1,
			successfulFiles: 2,
			skippedFiles: 0,
		});
		await nextTick();

		expect(mockToastCustom).toHaveBeenCalledTimes(1);
		const callArgs = mockToastCustom.mock.calls[0];
		expect(callArgs[1].componentProps.isPartialFailure).toBe(true);
		expect(callArgs[1].componentProps.successCount).toBe(2);
		expect(callArgs[1].componentProps.failedCount).toBe(1);
		expect(callArgs[1].componentProps.skippedCount).toBe(0);
	});

	it('should include onClick handler when destinationPath exists (Req 8.7)', async () => {
		const { useOperationNotifications } = await import('./use-operation-notifications');
		const operationsStore = useOperationsStore();

		useOperationNotifications();

		const id = operationsStore.startOperation({
			type: 'copy',
			sourcePaths: ['/home/user/file.txt'],
			destinationPath: '/home/user/backup/',
		});

		operationsStore.completeOperation(id, 'completed');
		await nextTick();

		const callArgs = mockToastCustom.mock.calls[0];
		expect(callArgs[1].componentProps.onClick).toBeTypeOf('function');
	});

	it('should NOT include onClick handler when no destinationPath (delete operation)', async () => {
		const { useOperationNotifications } = await import('./use-operation-notifications');
		const operationsStore = useOperationsStore();

		useOperationNotifications();

		const id = operationsStore.startOperation({
			type: 'delete',
			sourcePaths: ['/home/user/file.txt'],
		});

		operationsStore.completeOperation(id, 'completed');
		await nextTick();

		const callArgs = mockToastCustom.mock.calls[0];
		expect(callArgs[1].componentProps.onClick).toBeUndefined();
	});

	it('should navigate to destination when onClick is called and directory exists (Req 8.7)', async () => {
		const { invoke } = await import('@tauri-apps/api/core');
		(invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ entries: [] });

		const { useOperationNotifications } = await import('./use-operation-notifications');
		const operationsStore = useOperationsStore();

		useOperationNotifications();

		const id = operationsStore.startOperation({
			type: 'copy',
			sourcePaths: ['/home/user/file.txt'],
			destinationPath: '/home/user/backup/',
		});

		operationsStore.completeOperation(id, 'completed');
		await nextTick();

		const callArgs = mockToastCustom.mock.calls[0];
		const onClick = callArgs[1].componentProps.onClick;

		await onClick();

		expect(invoke).toHaveBeenCalledWith('read_dir', { path: '/home/user/backup/' });
		expect(mockToastDismiss).toHaveBeenCalled();
		expect(mockOpenNewTabGroup).toHaveBeenCalledWith('/home/user/backup/');
	});

	it('should show error when destination no longer exists on click (Req 8.8)', async () => {
		const { invoke } = await import('@tauri-apps/api/core');
		(invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Directory not found'));

		const { useOperationNotifications } = await import('./use-operation-notifications');
		const operationsStore = useOperationsStore();

		useOperationNotifications();

		const id = operationsStore.startOperation({
			type: 'copy',
			sourcePaths: ['/home/user/file.txt'],
			destinationPath: '/home/user/deleted-dir/',
		});

		operationsStore.completeOperation(id, 'completed');
		await nextTick();

		const callArgs = mockToastCustom.mock.calls[0];
		const onClick = callArgs[1].componentProps.onClick;

		// Reset mock to capture the error toast
		mockToastCustom.mockClear();

		await onClick();

		expect(mockToastDismiss).toHaveBeenCalled();
		expect(mockOpenNewTabGroup).not.toHaveBeenCalled();
		// Should show error toast
		expect(mockToastCustom).toHaveBeenCalledTimes(1);
		const errorCallArgs = mockToastCustom.mock.calls[0];
		expect(errorCallArgs[1].componentProps.title).toContain('no se encuentra disponible');
	});

	it('should not notify about the same operation twice', async () => {
		const { useOperationNotifications } = await import('./use-operation-notifications');
		const operationsStore = useOperationsStore();

		useOperationNotifications();

		const id = operationsStore.startOperation({
			type: 'copy',
			sourcePaths: ['/home/user/file.txt'],
			destinationPath: '/home/user/backup/',
		});

		operationsStore.completeOperation(id, 'completed');
		await nextTick();
		await nextTick(); // Trigger watcher again

		expect(mockToastCustom).toHaveBeenCalledTimes(1);
	});

	it('should auto-dismiss notification after 5 seconds (Req 8.5)', async () => {
		const { useOperationNotifications } = await import('./use-operation-notifications');
		const operationsStore = useOperationsStore();

		useOperationNotifications();

		const id = operationsStore.startOperation({
			type: 'copy',
			sourcePaths: ['/home/user/file.txt'],
			destinationPath: '/home/user/backup/',
		});

		operationsStore.completeOperation(id, 'completed');
		await nextTick();

		// The toast.custom is called with duration: 5000 (auto-dismiss handled by toaster)
		const callArgs = mockToastCustom.mock.calls[0];
		expect(callArgs[1].duration).toBe(5000);
	});
});
