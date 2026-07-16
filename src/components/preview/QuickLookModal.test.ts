import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';

// Mock localStorage
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			store = {};
		}),
		get length() {
			return Object.keys(store).length;
		},
		key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
	};
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock document for DOM-related checks
Object.defineProperty(globalThis, 'document', {
	value: {
		activeElement: null,
		querySelectorAll: vi.fn(() => []),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	},
	writable: true,
});

describe('QuickLookModal — Shortcut Integration', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		localStorageMock.clear();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('should have toggleQuickLook shortcut defined with Space key', () => {
		const store = useShortcutsStore();
		const definition = store.getShortcutDefinition('toggleQuickLook');

		expect(definition).toBeDefined();
		expect(definition?.defaultKeys.key).toBe(' ');
		expect(definition?.scope).toBe('navigator');
		expect(definition?.conditions.inputFieldIsActive).toBe(false);
		expect(definition?.conditions.dialogIsOpened).toBe(false);
		expect(definition?.conditions.dirItemIsSelected).toBe(true);
	});

	it('should not conflict with toggleItemSelection (Ctrl+Space)', () => {
		const store = useShortcutsStore();
		const quickLookDef = store.getShortcutDefinition('toggleQuickLook');
		const itemSelectionDef = store.getShortcutDefinition('toggleItemSelection');

		expect(quickLookDef).toBeDefined();
		expect(itemSelectionDef).toBeDefined();

		// Quick Look is just Space (no modifiers)
		expect(quickLookDef?.defaultKeys.ctrl).toBeUndefined();
		// toggleItemSelection is Ctrl+Space
		expect(itemSelectionDef?.defaultKeys.ctrl).toBe(true);
	});

	it('should format toggleQuickLook shortcut label as Space', () => {
		const store = useShortcutsStore();
		const label = store.getShortcutLabel('toggleQuickLook');
		expect(label).toBe('Space');
	});

	it('should not be read-only (user can customize)', () => {
		const store = useShortcutsStore();
		const definition = store.getShortcutDefinition('toggleQuickLook');
		expect(definition?.isReadOnly).toBe(false);
	});

	it('handler should be registrable and callable', () => {
		const store = useShortcutsStore();
		const handler = vi.fn(() => undefined);

		store.registerHandler('toggleQuickLook', handler, {
			checkItemSelected: () => true,
		});

		// Simulate a key event matching Space
		const event = new KeyboardEvent('keydown', {
			key: ' ',
			code: 'Space',
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			metaKey: false,
		});

		// Directly call handleKeydown (not via DOM listener since document is mocked)
		store.handleKeydown(event);

		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('handler should not be called when conditions fail (no item selected)', () => {
		const store = useShortcutsStore();
		const handler = vi.fn(() => undefined);

		store.registerHandler('toggleQuickLook', handler, {
			checkItemSelected: () => false, // no item selected
		});

		const event = new KeyboardEvent('keydown', {
			key: ' ',
			code: 'Space',
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			metaKey: false,
		});

		store.handleKeydown(event);

		expect(handler).not.toHaveBeenCalled();
	});

	it('should allow customizing the Quick Look shortcut', () => {
		const store = useShortcutsStore();

		// Assign a new key combination (Ctrl+Q is unused)
		const result = store.assignCustomKeys('toggleQuickLook', { ctrl: true, key: 'q' });

		expect(result.success).toBe(true);
		expect(store.getShortcutKeys('toggleQuickLook')).toEqual({ ctrl: true, key: 'q' });
		expect(store.isCustomized('toggleQuickLook')).toBe(true);
	});
});
