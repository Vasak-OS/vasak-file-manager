// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

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
	| 'edit-tags'
	| 'extract-here'
	| 'list-archive'
	| 'compress';
