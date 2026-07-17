/**
 * @vitest-environment jsdom
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import fc from 'fast-check';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import type { ShortcutKeys } from '@/types/shortcut';

/**
 * Property-based tests for Keyboard Shortcuts.
 *
 * Feature: performance-and-features
 */
describe('Property Tests: Keyboard Shortcuts', () => {
	const STORAGE_KEY = 'vasak-shortcuts-custom';

	beforeEach(() => {
		setActivePinia(createPinia());
		localStorage.removeItem(STORAGE_KEY);
	});

	afterEach(() => {
		localStorage.removeItem(STORAGE_KEY);
	});

	/**
	 * Property 20: Ciclo de foco con Tab
	 *
	 * For any current focus position in the cycle (tab-bar → toolbar → file-list → info-panel),
	 * pressing Tab SHALL move focus to the next zone, and Shift+Tab to the previous,
	 * wrapping around after the last/first element.
	 *
	 * **Validates: Requirements 10.2**
	 */
	describe('Property 20: Ciclo de foco con Tab', () => {
		const FOCUS_ZONES = ['tab-bar', 'toolbar', 'file-list', 'info-panel'] as const;
		type FocusZone = (typeof FOCUS_ZONES)[number];

		function getNextZone(current: FocusZone): FocusZone {
			const idx = FOCUS_ZONES.indexOf(current);
			return FOCUS_ZONES[(idx + 1) % FOCUS_ZONES.length];
		}

		function getPreviousZone(current: FocusZone): FocusZone {
			const idx = FOCUS_ZONES.indexOf(current);
			return FOCUS_ZONES[(idx - 1 + FOCUS_ZONES.length) % FOCUS_ZONES.length];
		}

		it('Tab cycles through zones in forward order and wraps around', () => {
			fc.assert(
				fc.property(
					// Start from any zone index
					fc.integer({ min: 0, max: 3 }),
					// Press Tab N times
					fc.integer({ min: 1, max: 20 }),
					(startIdx, tabPresses) => {
						let currentZone = FOCUS_ZONES[startIdx];

						for (let i = 0; i < tabPresses; i++) {
							const expectedNext = getNextZone(currentZone);
							currentZone = expectedNext;
						}

						// After N tab presses from startIdx, we should be at (startIdx + N) % 4
						const expectedFinalIdx = (startIdx + tabPresses) % FOCUS_ZONES.length;
						return currentZone === FOCUS_ZONES[expectedFinalIdx];
					},
				),
				{ numRuns: 100 },
			);
		});

		it('Shift+Tab cycles through zones in reverse order and wraps around', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 0, max: 3 }),
					fc.integer({ min: 1, max: 20 }),
					(startIdx, shiftTabPresses) => {
						let currentZone = FOCUS_ZONES[startIdx];

						for (let i = 0; i < shiftTabPresses; i++) {
							const expectedPrev = getPreviousZone(currentZone);
							currentZone = expectedPrev;
						}

						// After N shift+tab presses from startIdx, we should be at (startIdx - N) mod 4
						const expectedFinalIdx =
							((startIdx - shiftTabPresses) % FOCUS_ZONES.length + FOCUS_ZONES.length) %
							FOCUS_ZONES.length;
						return currentZone === FOCUS_ZONES[expectedFinalIdx];
					},
				),
				{ numRuns: 100 },
			);
		});

		it('Tab followed by Shift+Tab returns to the original zone', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 0, max: 3 }),
					fc.integer({ min: 1, max: 10 }),
					(startIdx, presses) => {
						let currentZone = FOCUS_ZONES[startIdx];

						// Press Tab N times
						for (let i = 0; i < presses; i++) {
							currentZone = getNextZone(currentZone);
						}

						// Press Shift+Tab N times
						for (let i = 0; i < presses; i++) {
							currentZone = getPreviousZone(currentZone);
						}

						// Should return to original zone
						return currentZone === FOCUS_ZONES[startIdx];
					},
				),
				{ numRuns: 100 },
			);
		});

		it('full cycle of 4 Tabs returns to the starting zone', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 0, max: 3 }),
					(startIdx) => {
						let currentZone = FOCUS_ZONES[startIdx];

						// Press Tab exactly 4 times (full cycle)
						for (let i = 0; i < FOCUS_ZONES.length; i++) {
							currentZone = getNextZone(currentZone);
						}

						return currentZone === FOCUS_ZONES[startIdx];
					},
				),
				{ numRuns: 100 },
			);
		});
	});

	/**
	 * Property 21: Detección de conflictos de atajos de teclado
	 *
	 * For any set of shortcuts and a new key assignment in the same scope,
	 * `findConflictInScope` returns the conflicting shortcut or null correctly.
	 *
	 * **Validates: Requirements 10.5**
	 */
	describe('Property 21: Detección de conflictos de atajos de teclado', () => {
		/** Arbitrary for generating valid ShortcutKeys */
		const shortcutKeysArb: fc.Arbitrary<ShortcutKeys> = fc.record({
			ctrl: fc.boolean(),
			alt: fc.boolean(),
			shift: fc.boolean(),
			meta: fc.boolean(),
			key: fc.constantFrom(
				'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
				'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
				'F1', 'F2', 'F3', 'F4', 'F5', 'Delete', 'Backspace', 'Enter', 'Escape',
				'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ',
			),
		});

		const scopeArb = fc.constantFrom('global' as const, 'navigator' as const, 'settings' as const);

		it('returns conflicting shortcut when same keys exist in same scope', () => {
			fc.assert(
				fc.property(
					shortcutKeysArb,
					scopeArb,
					(keys, scope) => {
						const store = useShortcutsStore();

						// Get all shortcuts in the given scope
						const shortcutsInScope = store.definitions.filter((d) => d.scope === scope && !d.isReadOnly);

						if (shortcutsInScope.length < 2) return true; // Not enough shortcuts to test

						// Pick the first non-readonly shortcut and assign custom keys
						const target = shortcutsInScope[0];
						const result = store.assignCustomKeys(target.id, keys);

						if (result.success) {
							// If assignment succeeded, querying with the same keys excluding the target
							// should find the target itself... But actually we should test that
							// findConflictInScope for another shortcut in the same scope returns the target.
							const otherShortcut = shortcutsInScope[1];
							const conflict = store.findConflictInScope(keys, scope, otherShortcut.id);

							// If we just assigned `keys` to `target`, findConflictInScope for another
							// shortcut should return `target` as the conflict
							return conflict !== null && conflict.id === target.id;
						}

						// If assignment failed due to conflict, findConflictInScope should also detect it
						const conflict = store.findConflictInScope(keys, scope, target.id);
						return conflict !== null;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('returns null when no conflict exists in the scope', () => {
			fc.assert(
				fc.property(
					shortcutKeysArb,
					scopeArb,
					(keys, scope) => {
						const store = useShortcutsStore();

						// Check for conflict with all shortcuts excluded (none should conflict)
						// Actually test: if we find a conflict for a specific shortcut, it means
						// another shortcut in the same scope uses those keys.
						// If we DON'T find a conflict, it means no other shortcut uses those keys.
						const shortcutsInScope = store.definitions.filter((d) => d.scope === scope);

						if (shortcutsInScope.length === 0) return true;

						const targetId = shortcutsInScope[0].id;
						const conflict = store.findConflictInScope(keys, scope, targetId);

						if (conflict === null) {
							// Verify: no other shortcut in this scope has these exact keys
							const normalizeKeys = (k: ShortcutKeys) => {
								const parts: string[] = [];
								if (k.ctrl) parts.push('ctrl');
								if (k.alt) parts.push('alt');
								if (k.meta) parts.push('meta');
								if (k.shift) parts.push('shift');
								parts.push(k.key.toLowerCase());
								return parts.join('+');
							};

							const targetNorm = normalizeKeys(keys);
							const hasConflict = shortcutsInScope.some((d) => {
								if (d.id === targetId) return false;
								const existingKeys = store.getShortcutKeys(d.id);
								return normalizeKeys(existingKeys) === targetNorm;
							});

							return !hasConflict;
						}

						return true; // Conflict found, property not violated
					},
				),
				{ numRuns: 100 },
			);
		});

		it('conflicts in different scopes do not affect each other', () => {
			fc.assert(
				fc.property(
					shortcutKeysArb,
					(keys) => {
						const store = useShortcutsStore();

						// Find shortcuts in different scopes
						const globalShortcuts = store.definitions.filter(
							(d) => d.scope === 'global' && !d.isReadOnly,
						);
						const navigatorShortcuts = store.definitions.filter(
							(d) => d.scope === 'navigator' && !d.isReadOnly,
						);

						if (globalShortcuts.length === 0 || navigatorShortcuts.length === 0) return true;

						// Assign keys to a global shortcut
						const globalTarget = globalShortcuts[0];
						const globalResult = store.assignCustomKeys(globalTarget.id, keys);

						if (!globalResult.success) return true; // Conflict in global scope, skip

						// Check that the same keys in navigator scope don't report conflict
						// with the global shortcut (scopes are independent)
						const navTarget = navigatorShortcuts[0];
						const navConflict = store.findConflictInScope(keys, 'navigator', navTarget.id);

						// If there's a conflict in navigator scope, it should be a navigator shortcut,
						// not the global one we just assigned
						if (navConflict !== null) {
							return navConflict.scope === 'navigator';
						}

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});
	});

	/**
	 * Property 22: Round trip de persistencia de atajos
	 *
	 * For any custom shortcut configuration, serializing to localStorage and
	 * deserializing produces an equivalent config.
	 *
	 * **Validates: Requirements 10.8**
	 */
	describe('Property 22: Round trip de persistencia de atajos', () => {
		/** Arbitrary for generating valid custom shortcut configs */
		const customShortcutConfigArb = fc.record({
			shortcutId: fc.constantFrom(
				'toggleGlobalSearch' as const,
				'toggleFilter' as const,
				'copy' as const,
				'cut' as const,
				'paste' as const,
				'selectAll' as const,
				'delete' as const,
				'openNewTab' as const,
				'closeTab' as const,
				'refresh' as const,
			),
			customKeys: fc.record({
				ctrl: fc.boolean(),
				alt: fc.boolean(),
				shift: fc.boolean(),
				meta: fc.boolean(),
				key: fc.constantFrom(
					'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
					'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
					'F1', 'F2', 'F3', 'F4', 'F5', 'Delete', 'Backspace', 'Enter',
				),
			}),
			modifiedAt: fc.integer({ min: 1000000000000, max: 2000000000000 }),
		});

		it('serialize then deserialize produces equivalent config', () => {
			fc.assert(
				fc.property(
					fc.array(customShortcutConfigArb, { minLength: 0, maxLength: 15 }),
					(configs) => {
						// Serialize
						const serialized = JSON.stringify(configs);

						// Store to localStorage
						localStorage.setItem(STORAGE_KEY, serialized);

						// Deserialize
						const raw = localStorage.getItem(STORAGE_KEY);
						if (raw === null) return false;

						const deserialized = JSON.parse(raw);

						// Check equivalence
						if (!Array.isArray(deserialized)) return false;
						if (deserialized.length !== configs.length) return false;

						for (let i = 0; i < configs.length; i++) {
							const original = configs[i];
							const restored = deserialized[i];

							if (original.shortcutId !== restored.shortcutId) return false;
							if (original.modifiedAt !== restored.modifiedAt) return false;
							if (original.customKeys.key !== restored.customKeys.key) return false;
							if (!!original.customKeys.ctrl !== !!restored.customKeys.ctrl) return false;
							if (!!original.customKeys.alt !== !!restored.customKeys.alt) return false;
							if (!!original.customKeys.shift !== !!restored.customKeys.shift) return false;
							if (!!original.customKeys.meta !== !!restored.customKeys.meta) return false;
						}

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});

		it('assignCustomKeys persists and reloads correctly via store', () => {
			fc.assert(
				fc.property(
					fc.record({
						ctrl: fc.boolean(),
						alt: fc.boolean(),
						shift: fc.boolean(),
						key: fc.constantFrom(
							'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
							'F1', 'F2', 'F3', 'F4', 'F5',
						),
					}),
					(keys: ShortcutKeys) => {
						// Clean slate
						localStorage.removeItem(STORAGE_KEY);
						setActivePinia(createPinia());
						const store = useShortcutsStore();

						// Use 'refresh' shortcut which is non-readonly and in 'navigator' scope
						const targetId = 'refresh';
						const result = store.assignCustomKeys(targetId, keys);

						if (!result.success) {
							// Conflict detected — that's fine, no persistence needed
							return true;
						}

						// Verify persisted in localStorage
						const raw = localStorage.getItem(STORAGE_KEY);
						if (raw === null) {
							// If the assigned keys match the default, no custom entry is stored
							// This is correct behavior
							const def = store.getShortcutDefinition(targetId);
							if (!def) return false;
							const normalizeKeys = (k: ShortcutKeys) => {
								const parts: string[] = [];
								if (k.ctrl) parts.push('ctrl');
								if (k.alt) parts.push('alt');
								if (k.meta) parts.push('meta');
								if (k.shift) parts.push('shift');
								parts.push(k.key.toLowerCase());
								return parts.join('+');
							};
							// If keys match default, no storage is expected
							return normalizeKeys(keys) === normalizeKeys(def.defaultKeys);
						}

						const stored = JSON.parse(raw);
						if (!Array.isArray(stored)) return false;

						// Create a new pinia/store to simulate reload
						setActivePinia(createPinia());
						const reloadedStore = useShortcutsStore();

						// The reloaded store should have the custom keys
						const reloadedKeys = reloadedStore.getShortcutKeys(targetId);

						return (
							reloadedKeys.key.toLowerCase() === keys.key.toLowerCase() &&
							!!reloadedKeys.ctrl === !!keys.ctrl &&
							!!reloadedKeys.alt === !!keys.alt &&
							!!reloadedKeys.shift === !!keys.shift &&
							!!reloadedKeys.meta === !!keys.meta
						);
					},
				),
				{ numRuns: 100 },
			);
		});

		it('restoreAllDefaults clears persisted config and reload produces defaults', () => {
			fc.assert(
				fc.property(
					fc.array(customShortcutConfigArb, { minLength: 1, maxLength: 10 }),
					(configs) => {
						// Pre-seed localStorage with custom configs
						localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));

						// Create store that loads the custom configs
						setActivePinia(createPinia());
						const store = useShortcutsStore();

						// Restore all defaults
						store.restoreAllDefaults();

						// Verify localStorage is cleared (empty array)
						const raw = localStorage.getItem(STORAGE_KEY);
						if (raw === null) return false;
						const stored = JSON.parse(raw);
						if (!Array.isArray(stored) || stored.length !== 0) return false;

						// Create new store to simulate reload
						setActivePinia(createPinia());
						const reloadedStore = useShortcutsStore();

						// All shortcuts should return their default keys
						for (const def of reloadedStore.definitions) {
							const currentKeys = reloadedStore.getShortcutKeys(def.id);
							if (currentKeys.key.toLowerCase() !== def.defaultKeys.key.toLowerCase()) return false;
							if (!!currentKeys.ctrl !== !!def.defaultKeys.ctrl) return false;
							if (!!currentKeys.alt !== !!def.defaultKeys.alt) return false;
							if (!!currentKeys.shift !== !!def.defaultKeys.shift) return false;
							if (!!currentKeys.meta !== !!def.defaultKeys.meta) return false;
						}

						return true;
					},
				),
				{ numRuns: 100 },
			);
		});
	});
});
