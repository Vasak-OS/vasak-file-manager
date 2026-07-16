import { defineStore } from 'pinia';
import { ref, reactive, computed } from 'vue';
import type { ShortcutId, ShortcutKeys } from '@/types/shortcut';

export type ShortcutConditions = {
	inputFieldIsActive?: boolean;
	dialogIsOpened?: boolean;
	dirItemIsSelected?: boolean;
};

export type ShortcutDefinition = {
	id: ShortcutId;
	labelKey: string;
	defaultKeys: ShortcutKeys;
	scope: 'global' | 'navigator' | 'settings';
	conditions: ShortcutConditions;
	isReadOnly: boolean;
};

export interface CustomShortcutConfig {
	shortcutId: ShortcutId;
	customKeys: ShortcutKeys;
	modifiedAt: number;
}

const STORAGE_KEY = 'vasak-shortcuts-custom';

const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
	{
		id: 'toggleGlobalSearch',
		labelKey: 'shortcuts.showHideGlobalSearch',
		defaultKeys: {
			ctrl: true,
			shift: true,
			key: 'f',
		},
		scope: 'global',
		conditions: {
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'toggleFilter',
		labelKey: 'shortcuts.focusUnfocusFilterField',
		defaultKeys: {
			ctrl: true,
			key: 'f',
		},
		scope: 'navigator',
		conditions: {
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'toggleSettingsSearch',
		labelKey: 'shortcuts.focusUnfocusSettingsSearch',
		defaultKeys: {
			ctrl: true,
			key: 'f',
		},
		scope: 'settings',
		conditions: {
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'copy',
		labelKey: 'shortcuts.setSelectedItemsForCopying',
		defaultKeys: {
			ctrl: true,
			key: 'c',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'cut',
		labelKey: 'shortcuts.setSelectedItemsForMoving',
		defaultKeys: {
			ctrl: true,
			key: 'x',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'paste',
		labelKey: 'shortcuts.transferPreparedForCopying',
		defaultKeys: {
			ctrl: true,
			key: 'v',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'selectAll',
		labelKey: 'shortcuts.selectAllItemsInCurrentDirectory',
		defaultKeys: {
			ctrl: true,
			key: 'a',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'delete',
		labelKey: 'shortcuts.moveSelectedItemsToTrash',
		defaultKeys: {
			key: 'Delete',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'deletePermanently',
		labelKey: 'shortcuts.deleteSelectedItemsFromDrive',
		defaultKeys: {
			shift: true,
			key: 'Delete',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'rename',
		labelKey: 'shortcuts.renameSelectedItems',
		defaultKeys: {
			key: 'F2',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
			dirItemIsSelected: true,
		},
		isReadOnly: false,
	},
	{
		id: 'escape',
		labelKey: 'shortcuts.closeOpenedDialogOverlay',
		defaultKeys: {
			key: 'Escape',
		},
		scope: 'global',
		conditions: {},
		isReadOnly: true,
	},
	{
		id: 'openNewTab',
		labelKey: 'shortcuts.openCurrentDirInNewTab',
		defaultKeys: {
			ctrl: true,
			key: 't',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'openTerminal',
		labelKey: 'shortcuts.openCurrentDirInTerminal',
		defaultKeys: {
			alt: true,
			key: 't',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'openTerminalAdmin',
		labelKey: 'shortcuts.openCurrentDirInTerminalAsAdmin',
		defaultKeys: {
			alt: true,
			shift: true,
			key: 't',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'navigateUp',
		labelKey: 'shortcuts.navigateUp',
		defaultKeys: {
			key: 'ArrowUp',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'navigateDown',
		labelKey: 'shortcuts.navigateDown',
		defaultKeys: {
			key: 'ArrowDown',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'navigateLeft',
		labelKey: 'shortcuts.navigateLeft',
		defaultKeys: {
			key: 'ArrowLeft',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'navigateRight',
		labelKey: 'shortcuts.navigateRight',
		defaultKeys: {
			key: 'ArrowRight',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'openSelected',
		labelKey: 'shortcuts.openSelectedEntry',
		defaultKeys: {
			key: 'Enter',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
			dirItemIsSelected: true,
		},
		isReadOnly: false,
	},
	{
		id: 'navigateBack',
		labelKey: 'shortcuts.navigateBack',
		defaultKeys: {
			key: 'Backspace',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'switchToLeftPane',
		labelKey: 'shortcuts.switchToLeftPane',
		defaultKeys: {
			ctrl: true,
			key: 'ArrowLeft',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'switchToRightPane',
		labelKey: 'shortcuts.switchToRightPane',
		defaultKeys: {
			ctrl: true,
			key: 'ArrowRight',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'closeTab',
		labelKey: 'shortcuts.closeCurrentTab',
		defaultKeys: {
			ctrl: true,
			key: 'w',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'restoreClosedTab',
		labelKey: 'shortcuts.restoreClosedTab',
		defaultKeys: {
			ctrl: true,
			shift: true,
			key: 't',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'navigateBackAlt',
		labelKey: 'shortcuts.navigateBackAlt',
		defaultKeys: {
			alt: true,
			key: 'ArrowLeft',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'extendSelectionUp',
		labelKey: 'shortcuts.extendSelectionUp',
		defaultKeys: {
			shift: true,
			key: 'ArrowUp',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'extendSelectionDown',
		labelKey: 'shortcuts.extendSelectionDown',
		defaultKeys: {
			shift: true,
			key: 'ArrowDown',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'toggleItemSelection',
		labelKey: 'shortcuts.toggleItemSelection',
		defaultKeys: {
			ctrl: true,
			key: ' ',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'focusNextZone',
		labelKey: 'shortcuts.focusNextZone',
		defaultKeys: {
			key: 'Tab',
		},
		scope: 'global',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: true,
	},
	{
		id: 'focusPreviousZone',
		labelKey: 'shortcuts.focusPreviousZone',
		defaultKeys: {
			shift: true,
			key: 'Tab',
		},
		scope: 'global',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: true,
	},
	{
		id: 'refresh',
		labelKey: 'shortcuts.refreshCurrentDirectory',
		defaultKeys: {
			key: 'F5',
		},
		scope: 'navigator',
		conditions: {
			inputFieldIsActive: false,
			dialogIsOpened: false,
		},
		isReadOnly: false,
	},
	{
		id: 'showQuickReference',
		labelKey: 'shortcuts.showQuickReference',
		defaultKeys: {
			key: 'F1',
		},
		scope: 'global',
		conditions: {
			dialogIsOpened: false,
		},
		isReadOnly: true,
	},
];

export function formatShortcutKeys(keys: ShortcutKeys): string {
	const parts: string[] = [];

	if (keys.ctrl) parts.push('Ctrl');
	if (keys.alt) parts.push('Alt');
	if (keys.meta) parts.push('Win');
	if (keys.shift) parts.push('Shift');

	let keyDisplay = keys.key;

	if (keyDisplay === ' ') {
		keyDisplay = 'Space';
	} else if (keyDisplay.length === 1) {
		keyDisplay = keyDisplay.toUpperCase();
	} else if (keyDisplay === 'Delete') {
		keyDisplay = 'Del';
	} else if (keyDisplay === 'ArrowUp') {
		keyDisplay = '↑';
	} else if (keyDisplay === 'ArrowDown') {
		keyDisplay = '↓';
	} else if (keyDisplay === 'ArrowLeft') {
		keyDisplay = '←';
	} else if (keyDisplay === 'ArrowRight') {
		keyDisplay = '→';
	}

	parts.push(keyDisplay);

	return parts.join('+');
}

export function parseShortcutString(shortcutString: string): ShortcutKeys | null {
	const parts = shortcutString.split('+').map((part) => part.trim().toLowerCase());

	if (parts.length === 0) return null;

	const keys: ShortcutKeys = { key: '' };

	for (let partIndex = 0; partIndex < parts.length - 1; partIndex++) {
		const modifier = parts[partIndex];
		if (modifier === 'ctrl' || modifier === 'control') keys.ctrl = true;
		else if (modifier === 'alt') keys.alt = true;
		else if (modifier === 'shift') keys.shift = true;
		else if (modifier === 'meta' || modifier === 'cmd' || modifier === 'win') keys.meta = true;
	}

	const lastPart = parts[parts.length - 1];
	keys.key = lastPart.charAt(0).toUpperCase() + lastPart.slice(1);

	if (keys.key === 'Del') keys.key = 'Delete';
	if (keys.key === 'Space') keys.key = ' ';

	return keys;
}

function matchesShortcut(event: KeyboardEvent, keys: ShortcutKeys): boolean {
	const eventCtrl = event.ctrlKey || event.metaKey;
	const expectedCtrl = keys.ctrl || keys.meta || false;

	if (eventCtrl !== expectedCtrl) return false;
	if (event.altKey !== (keys.alt || false)) return false;
	if (event.shiftKey !== (keys.shift || false)) return false;

	const eventKey = event.key.toLowerCase();
	const expectedKey = keys.key.toLowerCase();

	if (expectedKey === ' ' && event.code === 'Space') return true;

	return eventKey === expectedKey || event.code.toLowerCase() === `key${expectedKey}`;
}

export function formatConditionsLabel(conditions: ShortcutConditions): string {
	const conditionLabels: string[] = [];

	if (conditions.inputFieldIsActive === false) {
		conditionLabels.push('!inputFocused');
	} else if (conditions.inputFieldIsActive === true) {
		conditionLabels.push('inputFocused');
	}

	if (conditions.dialogIsOpened === false) {
		conditionLabels.push('!dialogOpen');
	} else if (conditions.dialogIsOpened === true) {
		conditionLabels.push('dialogOpen');
	}

	if (conditions.dirItemIsSelected === true) {
		conditionLabels.push('itemSelected');
	} else if (conditions.dirItemIsSelected === false) {
		conditionLabels.push('!itemSelected');
	}

	return conditionLabels.join(' && ') || '';
}

function isInputFieldActive(): boolean {
	const activeElement = document.activeElement;
	if (!activeElement) return false;
	const tagName = activeElement.tagName.toLowerCase();
	return (
		tagName === 'input' ||
		tagName === 'textarea' ||
		(activeElement as HTMLElement).isContentEditable
	);
}

function isDialogOpened(): boolean {
	const dialogs = document.querySelectorAll('[role="dialog"]');

	for (const dialog of dialogs) {
		if (!dialog.classList.contains('sigma-ui-popover-content')) {
			return true;
		}
	}

	return false;
}

type ShortcutHandler = () => undefined | boolean | Promise<undefined | boolean>;

type HandlerRegistration = {
	handler: ShortcutHandler;
	checkItemSelected?: () => boolean;
};

/** Normalize ShortcutKeys to a canonical string for comparison */
function normalizeKeysToString(keys: ShortcutKeys): string {
	const parts: string[] = [];
	if (keys.ctrl) parts.push('ctrl');
	if (keys.alt) parts.push('alt');
	if (keys.meta) parts.push('meta');
	if (keys.shift) parts.push('shift');
	parts.push(keys.key.toLowerCase());
	return parts.join('+');
}

function loadCustomShortcuts(): CustomShortcutConfig[] {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored);
			if (Array.isArray(parsed)) {
				return parsed;
			}
		}
	} catch (error) {
		console.error('Failed to load custom shortcuts from storage:', error);
	}
	return [];
}

function persistCustomShortcuts(configs: CustomShortcutConfig[]): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
	} catch (error) {
		console.error('Failed to persist custom shortcuts:', error);
	}
}

export const useShortcutsStore = defineStore('shortcuts', () => {
	const definitions = ref<ShortcutDefinition[]>(DEFAULT_SHORTCUTS);
	const customConfigs = ref<CustomShortcutConfig[]>(loadCustomShortcuts());
	const handlers = reactive(new Map<ShortcutId, HandlerRegistration>());
	const isInitialized = ref(false);
	const isListenerActive = ref(false);
	const isQuickReferenceVisible = ref(false);
	const isConfigPanelVisible = ref(false);

	/** Shortcuts grouped by scope */
	const shortcutsByScope = computed(() => {
		const grouped: Record<string, ShortcutDefinition[]> = {
			global: [],
			navigator: [],
			settings: [],
		};
		for (const def of definitions.value) {
			grouped[def.scope].push(def);
		}
		return grouped;
	});

	function getShortcutKeys(shortcutId: ShortcutId): ShortcutKeys {
		// Check custom config first
		const custom = customConfigs.value.find((c) => c.shortcutId === shortcutId);
		if (custom) return custom.customKeys;

		const definition = definitions.value.find((definitionItem) => definitionItem.id === shortcutId);
		return definition?.defaultKeys ?? { key: '' };
	}

	function getShortcutLabel(shortcutId: ShortcutId): string {
		return formatShortcutKeys(getShortcutKeys(shortcutId));
	}

	function getShortcutDefinition(shortcutId: ShortcutId): ShortcutDefinition | undefined {
		return definitions.value.find((definitionItem) => definitionItem.id === shortcutId);
	}

	/** Check if a shortcut has been customized */
	function isCustomized(shortcutId: ShortcutId): boolean {
		return customConfigs.value.some((c) => c.shortcutId === shortcutId);
	}

	/**
	 * Detect conflict: find an existing shortcut that uses the same key combination
	 * within the same scope. Returns the conflicting definition or null.
	 */
	function findConflictInScope(
		keys: ShortcutKeys,
		scope: 'global' | 'navigator' | 'settings',
		excludeShortcutId?: ShortcutId
	): ShortcutDefinition | null {
		const targetNormalized = normalizeKeysToString(keys);

		for (const definition of definitions.value) {
			if (definition.id === excludeShortcutId) continue;
			if (definition.scope !== scope) continue;

			const existingKeys = getShortcutKeys(definition.id);
			const existingNormalized = normalizeKeysToString(existingKeys);

			if (existingNormalized === targetNormalized) {
				return definition;
			}
		}

		return null;
	}

	/** Legacy findConflictingShortcut (checks all scopes) */
	function findConflictingShortcut(
		keys: ShortcutKeys,
		excludeShortcutId?: ShortcutId
	): ShortcutDefinition | null {
		const keysLabel = formatShortcutKeys(keys);

		for (const definition of definitions.value) {
			if (definition.id === excludeShortcutId) continue;

			const existingLabel = getShortcutLabel(definition.id);

			if (existingLabel === keysLabel) {
				return definition;
			}
		}

		return null;
	}

	/**
	 * Assign a custom key combination to a shortcut.
	 * Returns { success: true } or { success: false, conflict: ShortcutDefinition }.
	 */
	function assignCustomKeys(
		shortcutId: ShortcutId,
		keys: ShortcutKeys
	): { success: true } | { success: false; conflict: ShortcutDefinition } {
		const definition = getShortcutDefinition(shortcutId);
		if (!definition || definition.isReadOnly) {
			return { success: true }; // Read-only shortcuts can't be changed
		}

		// Check for conflict in the same scope
		const conflict = findConflictInScope(keys, definition.scope, shortcutId);
		if (conflict) {
			return { success: false, conflict };
		}

		// Remove existing custom config for this shortcut
		const existingIndex = customConfigs.value.findIndex((c) => c.shortcutId === shortcutId);
		if (existingIndex >= 0) {
			customConfigs.value.splice(existingIndex, 1);
		}

		// Check if this is the same as default — if so, don't add a custom entry
		const defaultNormalized = normalizeKeysToString(definition.defaultKeys);
		const newNormalized = normalizeKeysToString(keys);
		if (defaultNormalized !== newNormalized) {
			customConfigs.value.push({
				shortcutId,
				customKeys: keys,
				modifiedAt: Date.now(),
			});
		}

		persistCustomShortcuts(customConfigs.value);
		return { success: true };
	}

	/** Reset a single shortcut to default */
	function resetShortcut(shortcutId: ShortcutId): void {
		const index = customConfigs.value.findIndex((c) => c.shortcutId === shortcutId);
		if (index >= 0) {
			customConfigs.value.splice(index, 1);
			persistCustomShortcuts(customConfigs.value);
		}
	}

	/** Restore all shortcuts to their default values */
	function restoreAllDefaults(): void {
		customConfigs.value = [];
		persistCustomShortcuts(customConfigs.value);
	}

	function checkConditions(
		definition: ShortcutDefinition,
		registration?: HandlerRegistration
	): boolean {
		const { conditions } = definition;

		if (conditions.inputFieldIsActive !== undefined) {
			if (isInputFieldActive() !== conditions.inputFieldIsActive) {
				return false;
			}
		}

		if (conditions.dialogIsOpened !== undefined) {
			if (isDialogOpened() !== conditions.dialogIsOpened) {
				return false;
			}
		}

		if (conditions.dirItemIsSelected !== undefined && registration?.checkItemSelected) {
			if (registration.checkItemSelected() !== conditions.dirItemIsSelected) {
				return false;
			}
		}

		return true;
	}

	function registerHandler(
		shortcutId: ShortcutId,
		handler: ShortcutHandler,
		options?: { checkItemSelected?: () => boolean }
	): void {
		handlers.set(shortcutId, {
			handler,
			checkItemSelected: options?.checkItemSelected,
		});
	}

	function unregisterHandler(shortcutId: ShortcutId): void {
		handlers.delete(shortcutId);
	}

	function findMatchingShortcut(event: KeyboardEvent): ShortcutId | null {
		for (const definition of definitions.value) {
			const keys = getShortcutKeys(definition.id);

			if (matchesShortcut(event, keys)) {
				return definition.id;
			}
		}

		return null;
	}

	function findAllMatchingShortcuts(event: KeyboardEvent): ShortcutId[] {
		const matchingShortcuts: ShortcutId[] = [];

		for (const definition of definitions.value) {
			const keys = getShortcutKeys(definition.id);

			if (matchesShortcut(event, keys)) {
				matchingShortcuts.push(definition.id);
			}
		}

		return matchingShortcuts;
	}

	async function handleKeydown(event: KeyboardEvent): Promise<boolean> {
		const matchingShortcutIds = findAllMatchingShortcuts(event);
		if (matchingShortcutIds.length === 0) return false;

		for (const shortcutId of matchingShortcutIds) {
			const definition = getShortcutDefinition(shortcutId);
			if (!definition) continue;

			const registration = handlers.get(shortcutId);
			if (!registration) continue;

			if (!checkConditions(definition, registration)) {
				continue;
			}

			const result = registration.handler();

			if (result instanceof Promise) {
				event.preventDefault();
				event.stopPropagation();
				const asyncResult = await result;
				return asyncResult !== false;
			} else {
				if (result !== false) {
					event.preventDefault();
					event.stopPropagation();
				}

				return result !== false;
			}
		}

		return false;
	}

	function globalKeydownHandler(event: KeyboardEvent): void {
		handleKeydown(event);
	}

	function startGlobalListener(): void {
		if (isListenerActive.value) return;
		document.addEventListener('keydown', globalKeydownHandler, { capture: true });
		isListenerActive.value = true;
	}

	function stopGlobalListener(): void {
		if (!isListenerActive.value) return;
		document.removeEventListener('keydown', globalKeydownHandler, { capture: true });
		isListenerActive.value = false;
	}

	function toggleQuickReference(): void {
		isQuickReferenceVisible.value = !isQuickReferenceVisible.value;
	}

	function toggleConfigPanel(): void {
		isConfigPanelVisible.value = !isConfigPanelVisible.value;
	}

	/** Alias for assignCustomKeys — used by config panel */
	function setCustomKeys(
		shortcutId: ShortcutId,
		keys: ShortcutKeys
	): { success: true } | { success: false; conflict: ShortcutDefinition } {
		return assignCustomKeys(shortcutId, keys);
	}

	/** Reset all shortcuts to their default values (alias for restoreAllDefaults) */
	function resetAllToDefaults(): void {
		restoreAllDefaults();
	}

	function init(): void {
		if (isInitialized.value) return;
		isInitialized.value = true;
		startGlobalListener();

		// Register F1 quick reference handler
		registerHandler('showQuickReference', () => {
			toggleQuickReference();
			return undefined;
		});
	}

	function cleanup(): void {
		stopGlobalListener();
		handlers.clear();
		isInitialized.value = false;
	}

	return {
		definitions,
		customConfigs,
		isInitialized,
		isQuickReferenceVisible,
		isConfigPanelVisible,
		shortcutsByScope,
		getShortcutKeys,
		getShortcutLabel,
		getShortcutDefinition,
		isCustomized,
		findConflictInScope,
		findConflictingShortcut,
		assignCustomKeys,
		setCustomKeys,
		resetShortcut,
		restoreAllDefaults,
		resetAllToDefaults,
		registerHandler,
		unregisterHandler,
		findMatchingShortcut,
		handleKeydown,
		startGlobalListener,
		stopGlobalListener,
		toggleQuickReference,
		toggleConfigPanel,
		init,
		cleanup,
	};
});
