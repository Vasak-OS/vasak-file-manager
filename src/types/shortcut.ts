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
	| 'quickView'
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
	| 'switchToRightPane';

export type ShortcutKeys = {
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	meta?: boolean;
	key: string;
};
