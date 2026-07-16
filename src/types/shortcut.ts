export type ShortcutId =
	| 'toggleGlobalSearch'
	| 'toggleFilter'
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
	| 'closeTab'
	| 'restoreClosedTab'
	| 'openTerminal'
	| 'openTerminalAdmin'
	| 'navigateUp'
	| 'navigateDown'
	| 'navigateLeft'
	| 'navigateRight'
	| 'openSelected'
	| 'navigateBack'
	| 'navigateBackAlt'
	| 'switchToLeftPane'
	| 'switchToRightPane'
	| 'extendSelectionUp'
	| 'extendSelectionDown'
	| 'toggleItemSelection'
	| 'focusNextZone'
	| 'focusPreviousZone'
	| 'refresh'
	| 'showQuickReference'
	| 'toggleQuickLook';

export type ShortcutKeys = {
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	meta?: boolean;
	key: string;
};
