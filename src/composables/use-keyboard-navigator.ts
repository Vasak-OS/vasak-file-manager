import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import type { DirEntry } from '@/types/dir-entry';

/**
 * Focus zones in cycling order.
 * Tab cycles: tab-bar → toolbar → file-list → info-panel
 * Shift+Tab cycles in reverse.
 */
export type FocusZone = 'tab-bar' | 'toolbar' | 'file-list' | 'info-panel';

const ZONE_ORDER: FocusZone[] = ['tab-bar', 'toolbar', 'file-list', 'info-panel'];
const ZONE_SELECTOR = '[data-focus-zone]';
const KEYBOARD_FOCUS_ATTR = 'data-keyboard-focus';

export interface KeyboardNavigatorOptions {
	/** Current entries in the file list */
	entries: Ref<DirEntry[]>;
	/** Currently selected entries */
	selectedEntries: Ref<DirEntry[]>;
	/** Last selected entry (anchor for range selection) */
	lastSelectedEntry: Ref<DirEntry | null>;
	/** Callback to replace selection with a single entry */
	replaceSelection: (entry: DirEntry) => void;
	/** Callback to add entry to selection */
	addToSelection: (entry: DirEntry) => void;
	/** Callback to remove entry from selection */
	removeFromSelection: (entry: DirEntry) => void;
	/** Whether the navigator is active (e.g., pane has focus) */
	isActive?: Ref<boolean>;
}

export interface KeyboardNavigatorReturn {
	/** Current focused zone */
	currentZone: Ref<FocusZone>;
	/** Whether keyboard navigation mode is active (for CSS focus indicator) */
	isKeyboardNavActive: Ref<boolean>;
	/** Move focus to the next zone in the cycle */
	focusNextZone: () => void;
	/** Move focus to the previous zone in the cycle */
	focusPreviousZone: () => void;
	/** Move focus to a specific zone */
	focusZone: (zone: FocusZone) => void;
	/** Extend contiguous selection upward (Shift+ArrowUp) */
	extendSelectionUp: () => void;
	/** Extend contiguous selection downward (Shift+ArrowDown) */
	extendSelectionDown: () => void;
	/** Toggle selection on the currently focused item (Ctrl+Space) */
	toggleItemSelection: () => void;
	/** Register shortcut handlers with the shortcuts store */
	registerHandlers: () => void;
	/** Unregister shortcut handlers */
	unregisterHandlers: () => void;
}

/**
 * Composable that provides zone-based keyboard navigation, multi-selection
 * support (contiguous and discontinuous), and visible focus indicator management.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.7
 */
export function useKeyboardNavigator(options: KeyboardNavigatorOptions): KeyboardNavigatorReturn {
	const shortcutsStore = useShortcutsStore();
	const currentZone = ref<FocusZone>('file-list');
	const isKeyboardNavActive = ref(false);
	// Tracks the selection anchor for shift+arrow range extension
	const selectionAnchorIndex = ref<number>(-1);

	// --- Focus indicator management ---

	function enableKeyboardFocusIndicator() {
		if (!isKeyboardNavActive.value) {
			isKeyboardNavActive.value = true;
			document.documentElement.setAttribute(KEYBOARD_FOCUS_ATTR, '');
		}
	}

	function disableKeyboardFocusIndicator() {
		if (isKeyboardNavActive.value) {
			isKeyboardNavActive.value = false;
			document.documentElement.removeAttribute(KEYBOARD_FOCUS_ATTR);
		}
	}

	function handleMouseDown() {
		disableKeyboardFocusIndicator();
	}

	function handleKeyDown() {
		enableKeyboardFocusIndicator();
	}

	// --- Zone navigation ---

	function getZoneElement(zone: FocusZone): HTMLElement | null {
		return document.querySelector<HTMLElement>(`[data-focus-zone="${zone}"]`);
	}

	function getFocusableInZone(zone: FocusZone): HTMLElement | null {
		const zoneEl = getZoneElement(zone);
		if (!zoneEl) return null;

		// Try to find first focusable child, or the zone element itself
		const focusable = zoneEl.querySelector<HTMLElement>(
			'button, [tabindex="0"], a[href], input, select, textarea, [data-entry-path]'
		);
		return focusable || zoneEl;
	}

	function focusZone(zone: FocusZone) {
		enableKeyboardFocusIndicator();
		currentZone.value = zone;
		const target = getFocusableInZone(zone);
		if (target) {
			target.focus({ preventScroll: false });
		}
	}

	function focusNextZone() {
		const currentIndex = ZONE_ORDER.indexOf(currentZone.value);
		// Cycle forward, wrapping to start
		let nextIndex = (currentIndex + 1) % ZONE_ORDER.length;
		// Skip zones that don't exist in the DOM
		let attempts = 0;
		while (attempts < ZONE_ORDER.length) {
			const zone = ZONE_ORDER[nextIndex];
			if (getZoneElement(zone)) {
				focusZone(zone);
				return;
			}
			nextIndex = (nextIndex + 1) % ZONE_ORDER.length;
			attempts++;
		}
	}

	function focusPreviousZone() {
		const currentIndex = ZONE_ORDER.indexOf(currentZone.value);
		// Cycle backward, wrapping to end
		let prevIndex = (currentIndex - 1 + ZONE_ORDER.length) % ZONE_ORDER.length;
		let attempts = 0;
		while (attempts < ZONE_ORDER.length) {
			const zone = ZONE_ORDER[prevIndex];
			if (getZoneElement(zone)) {
				focusZone(zone);
				return;
			}
			prevIndex = (prevIndex - 1 + ZONE_ORDER.length) % ZONE_ORDER.length;
			attempts++;
		}
	}

	// --- Multi-selection support ---

	function findEntryIndex(path: string): number {
		return options.entries.value.findIndex((e) => e.path === path);
	}

	function getFocusedEntryIndex(): number {
		const selected = options.selectedEntries.value;
		if (selected.length === 0) return -1;
		// Use the last selected entry as the "focused" one
		const last = selected[selected.length - 1];
		return findEntryIndex(last.path);
	}

	/**
	 * Extend contiguous selection upward (Shift+ArrowUp).
	 * Selects a range from the anchor to the new position.
	 */
	function extendSelectionUp() {
		const entries = options.entries.value;
		if (entries.length === 0) return;

		const currentIndex = getFocusedEntryIndex();
		if (currentIndex <= 0) return;

		// Initialize anchor if not set
		if (selectionAnchorIndex.value === -1) {
			selectionAnchorIndex.value = currentIndex;
		}

		const targetIndex = currentIndex - 1;
		const anchor = selectionAnchorIndex.value;

		// Select the range from anchor to target
		const start = Math.min(anchor, targetIndex);
		const end = Math.max(anchor, targetIndex);
		const rangeEntries = entries.slice(start, end + 1);

		// Replace entire selection with the range
		options.replaceSelection(rangeEntries[0]);
		for (let i = 1; i < rangeEntries.length; i++) {
			options.addToSelection(rangeEntries[i]);
		}
	}

	/**
	 * Extend contiguous selection downward (Shift+ArrowDown).
	 * Selects a range from the anchor to the new position.
	 */
	function extendSelectionDown() {
		const entries = options.entries.value;
		if (entries.length === 0) return;

		const currentIndex = getFocusedEntryIndex();
		if (currentIndex === -1 || currentIndex >= entries.length - 1) return;

		// Initialize anchor if not set
		if (selectionAnchorIndex.value === -1) {
			selectionAnchorIndex.value = currentIndex;
		}

		const targetIndex = currentIndex + 1;
		const anchor = selectionAnchorIndex.value;

		// Select the range from anchor to target
		const start = Math.min(anchor, targetIndex);
		const end = Math.max(anchor, targetIndex);
		const rangeEntries = entries.slice(start, end + 1);

		// Replace entire selection with the range
		options.replaceSelection(rangeEntries[0]);
		for (let i = 1; i < rangeEntries.length; i++) {
			options.addToSelection(rangeEntries[i]);
		}
	}

	/**
	 * Toggle selection on the currently focused item (Ctrl+Space).
	 * Allows discontinuous multi-selection.
	 */
	function toggleItemSelection() {
		const selected = options.selectedEntries.value;
		if (selected.length === 0) return;

		const lastEntry = selected[selected.length - 1];
		const isSelected = selected.some((e) => e.path === lastEntry.path);

		if (isSelected && selected.length > 1) {
			// If there are multiple selections, toggling removes the focused item
			options.removeFromSelection(lastEntry);
		} else if (!isSelected) {
			options.addToSelection(lastEntry);
		}
		// Reset anchor when using discontinuous selection
		selectionAnchorIndex.value = -1;
	}

	// --- Shortcut handler registration ---

	function registerHandlers() {
		shortcutsStore.registerHandler('focusNextZone', () => {
			focusNextZone();
			return true;
		});

		shortcutsStore.registerHandler('focusPreviousZone', () => {
			focusPreviousZone();
			return true;
		});

		shortcutsStore.registerHandler('extendSelectionUp', () => {
			extendSelectionUp();
			return true;
		});

		shortcutsStore.registerHandler('extendSelectionDown', () => {
			extendSelectionDown();
			return true;
		});

		shortcutsStore.registerHandler('toggleItemSelection', () => {
			toggleItemSelection();
			return true;
		});
	}

	function unregisterHandlers() {
		shortcutsStore.unregisterHandler('focusNextZone');
		shortcutsStore.unregisterHandler('focusPreviousZone');
		shortcutsStore.unregisterHandler('extendSelectionUp');
		shortcutsStore.unregisterHandler('extendSelectionDown');
		shortcutsStore.unregisterHandler('toggleItemSelection');
	}

	// --- Lifecycle ---

	onMounted(() => {
		document.addEventListener('mousedown', handleMouseDown);
		document.addEventListener('keydown', handleKeyDown);
	});

	onUnmounted(() => {
		document.removeEventListener('mousedown', handleMouseDown);
		document.removeEventListener('keydown', handleKeyDown);
		disableKeyboardFocusIndicator();
	});

	return {
		currentZone,
		isKeyboardNavActive,
		focusNextZone,
		focusPreviousZone,
		focusZone,
		extendSelectionUp,
		extendSelectionDown,
		toggleItemSelection,
		registerHandlers,
		unregisterHandlers,
	};
}
