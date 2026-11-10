// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

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
	type: 'directory' | 'file' | 'search';
	paneWidth: number;
	filterQuery: string;
	iconScale: number;
	dirEntries: DirEntry[];
	selectedDirEntries: DirEntry[];
};

export type TabGroup = Tab[];

export type TabAction = {
	name: string;
	path: string;
};
