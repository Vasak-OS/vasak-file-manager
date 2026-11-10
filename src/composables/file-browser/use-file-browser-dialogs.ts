// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

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
	createNewItem: (
		name: string,
		itemType: 'directory' | 'file',
		templatePath?: string
	) => Promise<boolean>;
}) {
	const openWithState = ref({
		isOpen: false,
		entries: [] as DirEntry[],
	});

	const newItemDialogState = ref({
		isOpen: false,
		type: 'directory' as 'directory' | 'file' | 'template',
		templatePath: undefined as string | undefined,
		defaultName: undefined as string | undefined,
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
			templatePath: undefined,
			defaultName: undefined,
		};
	}

	/** Abre el diálogo para copiar una plantilla de `~/Templates` con nombre editable. */
	function openTemplateDialog(template: { path: string; name: string }) {
		newItemDialogState.value = {
			isOpen: true,
			type: 'template',
			templatePath: template.path,
			defaultName: template.name,
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
		const { type, templatePath } = newItemDialogState.value;
		// Una plantilla crea un archivo (copiándola); el resto, lo de siempre.
		const itemType = type === 'directory' ? 'directory' : 'file';
		const success = await options.createNewItem(name, itemType, templatePath);

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
		openTemplateDialog,
		closeNewItemDialog,
		handleRenameConfirm,
		handleRenameCancel,
		handleBatchRenameConfirm,
		handleBatchRenameCancel,
		handleNewItemConfirm,
		handleNewItemCancel,
	};
}
