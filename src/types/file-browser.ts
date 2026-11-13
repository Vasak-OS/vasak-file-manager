// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

import type { DirContents, DirEntry } from '@/types/dir-entry';
import type { Tab } from '@/types/workspaces';

export interface FileBrowserProps {
	tab?: Tab;
	paneIndex?: number;
	layout?: 'list' | 'grid';
}

export interface FileBrowserEmits {
	'update:selectedEntries': [entries: DirEntry[]];
	'update:currentDirEntry': [entry: DirEntry | null];
}

export interface NavigationState {
	currentPath: string;
	dirContents: DirContents | null;
	isLoading: boolean;
	error: string | null;
	history: string[];
	historyIndex: number;
	pathInput: string;
}

export interface SelectionState {
	selectedEntries: DirEntry[];
	lastSelectedEntry: DirEntry | null;
	mouseDownState: {
		item: DirEntry | null;
		wasSelected: boolean;
		awaitsSecondClick: boolean;
		lastMouseUpTime: number;
		ctrlKey: boolean;
		shiftKey: boolean;
	};
}

export interface ContextMenuState {
	targetEntry: DirEntry | null;
	selectedEntries: DirEntry[];
}

export interface GroupedEntries {
	dirs: DirEntry[];
	images: DirEntry[];
	videos: DirEntry[];
	others: DirEntry[];
}

export type ContextMenuAction =
	| 'rename'
	| 'batch-rename'
	| 'copy'
	| 'cut'
	| 'paste'
	| 'delete'
	| 'delete-permanently'
	| 'open-with'
	| 'quick-view'
	| 'share'
	| 'open-in-new-tab'
	| 'toggle-favorite'
	| 'edit-tags'
	| 'copy-path'
	| 'properties'
	| 'extract-here'
	| 'list-archive'
	| 'compress';

export type ArchiveFormat =
	| 'zip'
	| 'tar.gz'
	| 'tar.xz'
	| 'tar.bz2'
	| 'tar.zst'
	| 'tar'
	| 'cpio'
	| '7z';

export type SelectionType = 'single' | 'multiple';
export type EntryType = 'file' | 'directory';

export interface ContextMenuItemConfig {
	action: ContextMenuAction;
	selectionTypes: SelectionType[];
	entryTypes: EntryType[];
	extensions?: readonly string[];
}

export type ListSortColumn = 'name' | 'items' | 'size' | 'modified';

export type ListSortDirection = 'asc' | 'desc';
