import type { DirEntry } from './dir-entry';

export type Workspace = {
	id: number;
	isPrimary: boolean;
	isCurrent: boolean;
	name: string;
	actions: TabAction[];
	tabGroups: TabGroup[];
	currentTabGroupIndex: number;
	currentTabIndex: number;
};

export type Tab = {
	id: string;
	name: string;
	path: string;
	type: 'directory' | 'file' | 'search' | 'archive';
	paneWidth: number;
	filterQuery: string;
	dirEntries: DirEntry[];
	selectedDirEntries: DirEntry[];
	isPinned?: boolean;
	pinnedAt?: number;
	/** When type is 'archive', the path to the archive file being browsed */
	archivePath?: string;
	/** When type is 'archive', the internal path within the archive */
	archiveInternalPath?: string;
};

export type TabGroup = Tab[];

export type TabAction = {
	name: string;
	path: string;
};
