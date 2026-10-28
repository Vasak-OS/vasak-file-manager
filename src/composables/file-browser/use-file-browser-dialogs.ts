import { computed, type Ref, ref } from 'vue';
import type { DirEntry } from '@/types/dir-entry';

type RenameState = {
	isActive: boolean;
	entry: DirEntry | null;
};

type BatchRename = { sourcePath: string; newName: string };

type BatchRenameState = {
	isActive: boolean;
	entries: DirEntry[];
};

export function useFileBrowserDialogs(options: {
	renameState: Ref<RenameState>;
	cancelRename: () => void;
	batchRenameState: Ref<BatchRenameState>;
	cancelBatchRename: () => void;
	confirmBatchRename: (renames: BatchRename[]) => Promise<boolean>;
	confirmRename: (newName: string) => Promise<boolean>;
	createNewItem: (name: string, itemType: 'directory' | 'file') => Promise<boolean>;
}) {
	const openWithState = ref({
		isOpen: false,
		entries: [] as DirEntry[],
	});

	const newItemDialogState = ref({
		isOpen: false,
		type: 'directory' as 'directory' | 'file',
	});

	const isRenameDialogOpen = computed({
		get: () => options.renameState.value.isActive,
		set: (value: boolean) => {
			if (!value) {
				options.cancelRename();
			}
		},
	});

	const isBatchRenameDialogOpen = computed({
		get: () => options.batchRenameState.value.isActive,
		set: (value: boolean) => {
			if (!value) {
				options.cancelBatchRename();
			}
		},
	});

	const isNewItemDialogOpen = computed({
		get: () => newItemDialogState.value.isOpen,
		set: (value: boolean) => {
			if (!value) {
				closeNewItemDialog();
			} else {
				newItemDialogState.value.isOpen = true;
			}
		},
	});

	function openOpenWithDialog(entries: DirEntry[]) {
		openWithState.value = {
			isOpen: true,
			entries: [...entries],
		};
	}

	function closeOpenWithDialog() {
		openWithState.value = {
			isOpen: false,
			entries: [],
		};
	}

	function openNewItemDialog(type: 'directory' | 'file') {
		newItemDialogState.value = {
			isOpen: true,
			type,
		};
	}

	function closeNewItemDialog() {
		newItemDialogState.value.isOpen = false;
	}

	async function handleRenameConfirm(newName: string) {
		await options.confirmRename(newName);
	}

	function handleRenameCancel() {
		options.cancelRename();
	}

	async function handleBatchRenameConfirm(renames: BatchRename[]) {
		await options.confirmBatchRename(renames);
	}

	function handleBatchRenameCancel() {
		options.cancelBatchRename();
	}

	async function handleNewItemConfirm(name: string) {
		const success = await options.createNewItem(name, newItemDialogState.value.type);

		if (success) {
			closeNewItemDialog();
		}
	}

	function handleNewItemCancel() {
		closeNewItemDialog();
	}

	return {
		openWithState,
		newItemDialogState,
		isRenameDialogOpen,
		isBatchRenameDialogOpen,
		isNewItemDialogOpen,
		openOpenWithDialog,
		closeOpenWithDialog,
		openNewItemDialog,
		closeNewItemDialog,
		handleRenameConfirm,
		handleRenameCancel,
		handleBatchRenameConfirm,
		handleBatchRenameCancel,
		handleNewItemConfirm,
		handleNewItemCancel,
	};
}
