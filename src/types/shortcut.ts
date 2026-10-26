export type ShortcutId =
	| 'toggleGlobalSearch'
	| 'toggleFilter'
	| 'toggleHiddenFiles'
	| 'toggleSettingsSearch'
	| 'copy'
	| 'cut'
	| 'paste'
	| 'selectAll'
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
