/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import {
	useKeyboardNavigator,
	type FocusZone,
	type KeyboardNavigatorOptions,
} from './use-keyboard-navigator';
import type { DirEntry } from '@/types/dir-entry';

function createMockEntry(name: string, index: number): DirEntry {
	return {
		name,
		path: `/home/user/docs/${name}`,
		ext: null,
		size: 100 * (index + 1),
		item_count: null,
		modified_time: Date.now(),
		accessed_time: Date.now(),
		created_time: Date.now(),
		mime: null,
		is_file: true,
		is_dir: false,
		is_symlink: false,
		is_hidden: false,
	};
}

function setupDOM() {
	// Create zone elements in the DOM
	const tabBar = document.createElement('div');
	tabBar.setAttribute('data-focus-zone', 'tab-bar');
	tabBar.tabIndex = 0;

	const toolbar = document.createElement('div');
	toolbar.setAttribute('data-focus-zone', 'toolbar');
	const toolbarBtn = document.createElement('button');
	toolbar.appendChild(toolbarBtn);

	const fileList = document.createElement('div');
	fileList.setAttribute('data-focus-zone', 'file-list');
	fileList.tabIndex = 0;

	const infoPanel = document.createElement('div');
	infoPanel.setAttribute('data-focus-zone', 'info-panel');
	infoPanel.tabIndex = 0;

	document.body.appendChild(tabBar);
	document.body.appendChild(toolbar);
	document.body.appendChild(fileList);
	document.body.appendChild(infoPanel);

	return { tabBar, toolbar, fileList, infoPanel };
}

function teardownDOM() {
	document.body.innerHTML = '';
	document.documentElement.removeAttribute('data-keyboard-focus');
}

describe('useKeyboardNavigator', () => {
	let entries: ReturnType<typeof ref<DirEntry[]>>;
	let selectedEntries: ReturnType<typeof ref<DirEntry[]>>;
	let lastSelectedEntry: ReturnType<typeof ref<DirEntry | null>>;
	let replaceSelection: ReturnType<typeof vi.fn>;
	let addToSelection: ReturnType<typeof vi.fn>;
	let removeFromSelection: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		setActivePinia(createPinia());

		entries = ref([
			createMockEntry('file-a.txt', 0),
			createMockEntry('file-b.txt', 1),
			createMockEntry('file-c.txt', 2),
			createMockEntry('file-d.txt', 3),
			createMockEntry('file-e.txt', 4),
		]);
		selectedEntries = ref<DirEntry[]>([]);
		lastSelectedEntry = ref<DirEntry | null>(null);
		replaceSelection = vi.fn();
		addToSelection = vi.fn();
		removeFromSelection = vi.fn();
	});

	afterEach(() => {
		teardownDOM();
		vi.restoreAllMocks();
	});

	function createNavigator() {
		const opts: KeyboardNavigatorOptions = {
			entries,
			selectedEntries,
			lastSelectedEntry,
			replaceSelection,
			addToSelection,
			removeFromSelection,
		};
		// We call the composable directly — onMounted/onUnmounted won't fire in unit tests
		// but the logic we want to test is independent of lifecycle hooks
		return useKeyboardNavigator(opts);
	}

	describe('Zone-based focus navigation', () => {
		it('should start with file-list as default zone', () => {
			const navigator = createNavigator();
			expect(navigator.currentZone.value).toBe('file-list');
		});

		it('focusNextZone cycles through zones in order', () => {
			setupDOM();
			const navigator = createNavigator();

			// Start at file-list (default)
			navigator.focusZone('tab-bar');
			expect(navigator.currentZone.value).toBe('tab-bar');

			navigator.focusNextZone();
			expect(navigator.currentZone.value).toBe('toolbar');

			navigator.focusNextZone();
			expect(navigator.currentZone.value).toBe('file-list');

			navigator.focusNextZone();
			expect(navigator.currentZone.value).toBe('info-panel');

			// Wraps around
			navigator.focusNextZone();
			expect(navigator.currentZone.value).toBe('tab-bar');
		});

		it('focusPreviousZone cycles in reverse', () => {
			setupDOM();
			const navigator = createNavigator();

			navigator.focusZone('tab-bar');
			navigator.focusPreviousZone();
			expect(navigator.currentZone.value).toBe('info-panel');

			navigator.focusPreviousZone();
			expect(navigator.currentZone.value).toBe('file-list');

			navigator.focusPreviousZone();
			expect(navigator.currentZone.value).toBe('toolbar');

			navigator.focusPreviousZone();
			expect(navigator.currentZone.value).toBe('tab-bar');
		});

		it('skips zones not present in the DOM', () => {
			// Only create tab-bar and file-list (no toolbar, no info-panel)
			const tabBar = document.createElement('div');
			tabBar.setAttribute('data-focus-zone', 'tab-bar');
			tabBar.tabIndex = 0;
			document.body.appendChild(tabBar);

			const fileList = document.createElement('div');
			fileList.setAttribute('data-focus-zone', 'file-list');
			fileList.tabIndex = 0;
			document.body.appendChild(fileList);

			const navigator = createNavigator();
			navigator.focusZone('tab-bar');

			navigator.focusNextZone();
			// Should skip toolbar (not in DOM) and go to file-list
			expect(navigator.currentZone.value).toBe('file-list');

			navigator.focusNextZone();
			// Should skip info-panel (not in DOM) and wrap to tab-bar
			expect(navigator.currentZone.value).toBe('tab-bar');
		});
	});

	describe('Focus indicator', () => {
		it('enables keyboard focus attribute on focusZone call', () => {
			setupDOM();
			const navigator = createNavigator();

			navigator.focusZone('toolbar');
			expect(navigator.isKeyboardNavActive.value).toBe(true);
			expect(document.documentElement.hasAttribute('data-keyboard-focus')).toBe(true);
		});

		it('enables keyboard focus on focusNextZone', () => {
			setupDOM();
			const navigator = createNavigator();

			navigator.focusNextZone();
			expect(navigator.isKeyboardNavActive.value).toBe(true);
			expect(document.documentElement.hasAttribute('data-keyboard-focus')).toBe(true);
		});
	});

	describe('Multi-selection: extendSelectionDown', () => {
		it('extends selection downward from current position', () => {
			const navigator = createNavigator();

			// Simulate that file-b is currently selected (index 1)
			selectedEntries.value = [entries.value[1]];
			lastSelectedEntry.value = entries.value[1];

			navigator.extendSelectionDown();

			// Should call replaceSelection with entries[1] (anchor) then addToSelection for entries[2]
			expect(replaceSelection).toHaveBeenCalledWith(entries.value[1]);
			expect(addToSelection).toHaveBeenCalledWith(entries.value[2]);
		});

		it('does nothing when at the last entry', () => {
			const navigator = createNavigator();

			selectedEntries.value = [entries.value[4]];
			lastSelectedEntry.value = entries.value[4];

			navigator.extendSelectionDown();

			expect(replaceSelection).not.toHaveBeenCalled();
			expect(addToSelection).not.toHaveBeenCalled();
		});

		it('does nothing when no entries are selected', () => {
			const navigator = createNavigator();

			navigator.extendSelectionDown();

			expect(replaceSelection).not.toHaveBeenCalled();
		});
	});

	describe('Multi-selection: extendSelectionUp', () => {
		it('extends selection upward from current position', () => {
			const navigator = createNavigator();

			selectedEntries.value = [entries.value[2]];
			lastSelectedEntry.value = entries.value[2];

			navigator.extendSelectionUp();

			expect(replaceSelection).toHaveBeenCalledWith(entries.value[1]);
			expect(addToSelection).toHaveBeenCalledWith(entries.value[2]);
		});

		it('does nothing when at the first entry', () => {
			const navigator = createNavigator();

			selectedEntries.value = [entries.value[0]];
			lastSelectedEntry.value = entries.value[0];

			navigator.extendSelectionUp();

			expect(replaceSelection).not.toHaveBeenCalled();
			expect(addToSelection).not.toHaveBeenCalled();
		});
	});

	describe('Multi-selection: toggleItemSelection', () => {
		it('removes focused item when multiple are selected', () => {
			const navigator = createNavigator();

			selectedEntries.value = [entries.value[0], entries.value[2]];
			lastSelectedEntry.value = entries.value[2];

			navigator.toggleItemSelection();

			expect(removeFromSelection).toHaveBeenCalledWith(entries.value[2]);
		});

		it('does nothing when no entries are selected', () => {
			const navigator = createNavigator();
			selectedEntries.value = [];

			navigator.toggleItemSelection();

			expect(removeFromSelection).not.toHaveBeenCalled();
			expect(addToSelection).not.toHaveBeenCalled();
		});
	});

	describe('registerHandlers / unregisterHandlers', () => {
		it('registers and unregisters without error', () => {
			const navigator = createNavigator();

			expect(() => navigator.registerHandlers()).not.toThrow();
			expect(() => navigator.unregisterHandlers()).not.toThrow();
		});
	});
});
