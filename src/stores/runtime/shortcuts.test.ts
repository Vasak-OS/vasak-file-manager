import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useShortcutsStore, formatShortcutKeys } from './shortcuts';

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

describe('Shortcuts Store — Configuration & Conflict Detection', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		localStorageMock.clear();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('shortcutsByScope', () => {
		it('organizes shortcuts into global, navigator, and settings categories', () => {
			const store = useShortcutsStore();
			const byScope = store.shortcutsByScope;

			expect(byScope).toHaveProperty('global');
			expect(byScope).toHaveProperty('navigator');
			expect(byScope).toHaveProperty('settings');

			expect(byScope.global.length).toBeGreaterThan(0);
			expect(byScope.navigator.length).toBeGreaterThan(0);
			expect(byScope.settings.length).toBeGreaterThan(0);

			// All global shortcuts should have scope 'global'
			for (const s of byScope.global) {
				expect(s.scope).toBe('global');
			}
			for (const s of byScope.navigator) {
				expect(s.scope).toBe('navigator');
			}
			for (const s of byScope.settings) {
				expect(s.scope).toBe('settings');
			}
		});

		it('includes labelKey and isReadOnly for each shortcut', () => {
			const store = useShortcutsStore();
			const byScope = store.shortcutsByScope;

			for (const scope of Object.values(byScope)) {
				for (const shortcut of scope) {
					expect(shortcut).toHaveProperty('labelKey');
					expect(shortcut).toHaveProperty('isReadOnly');
					expect(shortcut).toHaveProperty('id');
					expect(shortcut).toHaveProperty('defaultKeys');
				}
			}
		});
	});

	describe('findConflictInScope — conflict detection', () => {
		it('detects conflict when same key combination exists in same scope', () => {
			const store = useShortcutsStore();

			// Ctrl+C is used by 'copy' in navigator scope
			const conflict = store.findConflictInScope(
				{ ctrl: true, key: 'c' },
				'navigator',
				'paste' // exclude paste, not copy
			);

			expect(conflict).not.toBeNull();
			expect(conflict!.id).toBe('copy');
		});

		it('returns null when combination is not used in same scope', () => {
			const store = useShortcutsStore();

			// Ctrl+Y is not used in any scope
			const conflict = store.findConflictInScope(
				{ ctrl: true, key: 'y' },
				'navigator'
			);

			expect(conflict).toBeNull();
		});

		it('excludes the shortcut being edited from conflict check', () => {
			const store = useShortcutsStore();

			// Ctrl+C is used by 'copy' — but if we exclude 'copy' itself, no conflict
			const conflict = store.findConflictInScope(
				{ ctrl: true, key: 'c' },
				'navigator',
				'copy'
			);

			expect(conflict).toBeNull();
		});

		it('does not detect conflict across different scopes', () => {
			const store = useShortcutsStore();

			// Ctrl+F is used in navigator ('toggleFilter') and settings ('toggleSettingsSearch')
			// Checking in global scope should find no conflict
			const conflict = store.findConflictInScope(
				{ ctrl: true, key: 'f' },
				'global'
			);

			expect(conflict).toBeNull();
		});

		it('detects conflict with customized shortcuts', () => {
			const store = useShortcutsStore();

			// Assign a custom shortcut first
			store.assignCustomKeys('paste', { ctrl: true, key: 'y' });

			// Now check if Ctrl+Y conflicts in navigator scope
			const conflict = store.findConflictInScope(
				{ ctrl: true, key: 'y' },
				'navigator',
				'copy' // exclude copy, not paste
			);

			expect(conflict).not.toBeNull();
			expect(conflict!.id).toBe('paste');
		});
	});

	describe('assignCustomKeys — custom key assignment', () => {
		it('assigns custom keys successfully when no conflict exists', () => {
			const store = useShortcutsStore();

			const result = store.assignCustomKeys('copy', { ctrl: true, key: 'y' });

			expect(result.success).toBe(true);
			expect(store.getShortcutKeys('copy')).toEqual({ ctrl: true, key: 'y' });
		});

		it('prevents assignment when conflict exists in same scope', () => {
			const store = useShortcutsStore();

			// Try to assign Ctrl+X (cut's shortcut) to copy
			const result = store.assignCustomKeys('copy', { ctrl: true, key: 'x' });

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.conflict.id).toBe('cut');
			}
		});

		it('does not create custom entry when keys match default', () => {
			const store = useShortcutsStore();

			// Assign the same keys as default
			const result = store.assignCustomKeys('copy', { ctrl: true, key: 'c' });

			expect(result.success).toBe(true);
			expect(store.isCustomized('copy')).toBe(false);
		});

		it('refuses to modify read-only shortcuts', () => {
			const store = useShortcutsStore();

			// 'escape' is read-only
			const result = store.assignCustomKeys('escape', { ctrl: true, key: 'q' });

			// Should return success (silently ignored) but not actually change
			expect(result.success).toBe(true);
			expect(store.getShortcutKeys('escape')).toEqual({ key: 'Escape' });
		});
	});

	describe('persistence — localStorage round-trip', () => {
		it('persists custom shortcuts to localStorage', () => {
			const store = useShortcutsStore();

			store.assignCustomKeys('copy', { ctrl: true, key: 'y' });

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'vasak-shortcuts-custom',
				expect.any(String)
			);

			const stored = JSON.parse(
				localStorageMock.setItem.mock.calls[localStorageMock.setItem.mock.calls.length - 1][1]
			);
			expect(stored).toHaveLength(1);
			expect(stored[0].shortcutId).toBe('copy');
			expect(stored[0].customKeys).toEqual({ ctrl: true, key: 'y' });
		});

		it('loads custom shortcuts from localStorage on store creation', () => {
			// Pre-populate localStorage
			const customConfigs = [
				{ shortcutId: 'copy', customKeys: { ctrl: true, key: 'y' }, modifiedAt: Date.now() },
			];
			localStorageMock.setItem('vasak-shortcuts-custom', JSON.stringify(customConfigs));

			const store = useShortcutsStore();

			expect(store.getShortcutKeys('copy')).toEqual({ ctrl: true, key: 'y' });
			expect(store.isCustomized('copy')).toBe(true);
		});

		it('handles corrupted localStorage gracefully', () => {
			localStorageMock.setItem('vasak-shortcuts-custom', 'invalid json{{{');

			// Should not throw
			const store = useShortcutsStore();
			expect(store.customConfigs).toEqual([]);
		});
	});

	describe('resetShortcut — reset single shortcut', () => {
		it('resets a customized shortcut to its default', () => {
			const store = useShortcutsStore();

			store.assignCustomKeys('copy', { ctrl: true, key: 'y' });
			expect(store.isCustomized('copy')).toBe(true);

			store.resetShortcut('copy');
			expect(store.isCustomized('copy')).toBe(false);
			expect(store.getShortcutKeys('copy')).toEqual({ ctrl: true, key: 'c' });
		});

		it('does nothing if shortcut is not customized', () => {
			const store = useShortcutsStore();

			store.resetShortcut('copy');
			expect(store.getShortcutKeys('copy')).toEqual({ ctrl: true, key: 'c' });
		});
	});

	describe('restoreAllDefaults / resetAllToDefaults', () => {
		it('removes all custom shortcuts', () => {
			const store = useShortcutsStore();

			store.assignCustomKeys('copy', { ctrl: true, key: 'y' });
			store.assignCustomKeys('paste', { ctrl: true, key: 'u' });

			expect(store.customConfigs.length).toBe(2);

			store.restoreAllDefaults();

			expect(store.customConfigs.length).toBe(0);
			expect(store.isCustomized('copy')).toBe(false);
			expect(store.isCustomized('paste')).toBe(false);
		});

		it('resetAllToDefaults is equivalent to restoreAllDefaults', () => {
			const store = useShortcutsStore();

			store.assignCustomKeys('copy', { ctrl: true, key: 'y' });
			store.resetAllToDefaults();

			expect(store.customConfigs.length).toBe(0);
		});
	});

	describe('setCustomKeys — alias for assignCustomKeys', () => {
		it('works identically to assignCustomKeys', () => {
			const store = useShortcutsStore();

			const result = store.setCustomKeys('copy', { ctrl: true, key: 'y' });

			expect(result.success).toBe(true);
			expect(store.getShortcutKeys('copy')).toEqual({ ctrl: true, key: 'y' });
		});
	});

	describe('isCustomized', () => {
		it('returns true for customized shortcuts', () => {
			const store = useShortcutsStore();

			store.assignCustomKeys('copy', { ctrl: true, key: 'y' });
			expect(store.isCustomized('copy')).toBe(true);
		});

		it('returns false for non-customized shortcuts', () => {
			const store = useShortcutsStore();

			expect(store.isCustomized('copy')).toBe(false);
		});
	});

	describe('toggleConfigPanel', () => {
		it('toggles config panel visibility', () => {
			const store = useShortcutsStore();

			expect(store.isConfigPanelVisible).toBe(false);
			store.toggleConfigPanel();
			expect(store.isConfigPanelVisible).toBe(true);
			store.toggleConfigPanel();
			expect(store.isConfigPanelVisible).toBe(false);
		});
	});

	describe('toggleQuickReference', () => {
		it('toggles quick reference visibility', () => {
			const store = useShortcutsStore();

			expect(store.isQuickReferenceVisible).toBe(false);
			store.toggleQuickReference();
			expect(store.isQuickReferenceVisible).toBe(true);
			store.toggleQuickReference();
			expect(store.isQuickReferenceVisible).toBe(false);
		});
	});

	describe('formatShortcutKeys', () => {
		it('formats modifier + key combinations correctly', () => {
			expect(formatShortcutKeys({ ctrl: true, key: 'c' })).toBe('Ctrl+C');
			expect(formatShortcutKeys({ ctrl: true, shift: true, key: 'f' })).toBe('Ctrl+Shift+F');
			expect(formatShortcutKeys({ alt: true, key: 't' })).toBe('Alt+T');
			expect(formatShortcutKeys({ key: 'F1' })).toBe('F1');
			expect(formatShortcutKeys({ key: ' ' })).toBe('Space');
			expect(formatShortcutKeys({ key: 'Delete' })).toBe('Del');
			expect(formatShortcutKeys({ key: 'ArrowUp' })).toBe('↑');
			expect(formatShortcutKeys({ key: 'ArrowDown' })).toBe('↓');
			expect(formatShortcutKeys({ key: 'ArrowLeft' })).toBe('←');
			expect(formatShortcutKeys({ key: 'ArrowRight' })).toBe('→');
		});

		it('formats meta key as Win', () => {
			expect(formatShortcutKeys({ meta: true, key: 'a' })).toBe('Win+A');
		});
	});
});
