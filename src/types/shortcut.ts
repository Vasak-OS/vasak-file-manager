// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

export type ShortcutId =
	| 'toggleGlobalSearch'
	| 'toggleFilter'
	| 'toggleHiddenFiles'
	| 'toggleSettingsSearch'
	| 'copy'
	| 'cut'
	| 'paste'
	| 'selectAll'
	| 'invertSelection'
	| 'selectByPattern'
	| 'copyPath'
	| 'showProperties'
	| 'addBookmark'
	| 'delete'
	| 'deletePermanently'
	| 'rename'
	| 'escape'
	| 'openNewTab'
	| 'openTerminal'
	| 'openTerminalAdmin'
	| 'navigateUp'
	| 'navigateDown'
	| 'navigateLeft'
	| 'navigateRight'
	| 'openSelected'
	| 'navigateBack'
	| 'switchToLeftPane'
	| 'switchToRightPane'
	| 'toggleSplitView'
	| 'toggleQuickView'
	| 'undo'
	| 'redo'
	| 'zoomIn'
	| 'zoomOut'
	| 'zoomReset'
	| 'newFolder'
	| 'closeTab'
	| 'nextTab'
	| 'previousTab'
	| 'reload'
	| 'goUp'
	| 'goBackHistory'
	| 'goForwardHistory'
	| 'goHome';

export type ShortcutKeys = {
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	meta?: boolean;
	key: string;
};
