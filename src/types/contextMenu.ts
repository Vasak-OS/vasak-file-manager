import type { DirEntry } from '@/types/dir-entry';

export interface ContextMenuState {
	targetEntry: DirEntry | null;
	selectedEntries: DirEntry[];
}

export type ContextMenuAction =
	| 'rename'
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
	| 'edit-tags';
