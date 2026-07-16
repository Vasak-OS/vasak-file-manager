import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useWorkspacesStore } from './workspaces';
import type { Tab, TabGroup } from '@/types/workspaces';

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn().mockResolvedValue([]),
}));

// Mock @tauri-apps/api/path
vi.mock('@tauri-apps/api/path', () => ({
	basename: vi.fn().mockImplementation((path: string) => {
		const parts = path.split('/').filter(Boolean);
		return Promise.resolve(parts[parts.length - 1] || path);
	}),
}));

// Mock @tauri-apps/plugin-store
vi.mock('@tauri-apps/plugin-store', () => ({
	LazyStore: vi.fn().mockImplementation(() => ({
		save: vi.fn(),
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn(),
	})),
}));

// Mock user-paths store
vi.mock('@/stores/storage/user-paths', () => ({
	useUserPathsStore: () => ({
		userPaths: { homeDir: '/home/user' },
		customPaths: { appUserDataWorkspacesPath: '/mock/workspaces.json' },
	}),
}));

// Mock navigator store
vi.mock('@/stores/runtime/navigator', () => ({
	useNavigatorStore: () => ({
		updateInfoPanel: vi.fn(),
	}),
}));

// Mock directory-cache store
vi.mock('@/stores/runtime/directory-cache', () => ({
	useDirectoryCacheStore: () => ({
		get: vi.fn().mockReturnValue(null),
	}),
}));

// Mock workspaces scheme
vi.mock('@/stores/scheme/workspaces', () => ({
	migrateWorkspacesStorage: vi.fn(),
	parseWorkspaces: vi.fn().mockReturnValue(null),
	WORKSPACES_SCHEMA_VERSION: 1,
	WORKSPACES_SCHEMA_VERSION_KEY: 'schemaVersion',
}));

function createTab(overrides: Partial<Tab> = {}): Tab {
	return {
		id: `tab-${Math.random().toString(36).slice(2, 8)}`,
		name: 'Test',
		path: '/home/user/Documents',
		type: 'directory',
		paneWidth: 100,
		filterQuery: '',
		dirEntries: [],
		selectedDirEntries: [],
		...overrides,
	};
}

describe('workspaces store — tab context menu operations', () => {
	let store: ReturnType<typeof useWorkspacesStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useWorkspacesStore();

		// Setup initial workspace with tabs
		store.workspaces[0].tabGroups = [];
		store.workspaces[0].currentTabGroupIndex = 0;
		store.workspaces[0].currentTabIndex = 0;
	});

	describe('duplicateTabGroup', () => {
		it('creates a new tab group adjacent to the source with the same path', async () => {
			const tab = createTab({ path: '/home/user/Downloads', name: 'Downloads' });
			store.workspaces[0].tabGroups = [[tab]];
			store.workspaces[0].currentTabGroupIndex = 0;

			await store.duplicateTabGroup([tab]);

			expect(store.workspaces[0].tabGroups).toHaveLength(2);
			const newTabGroup = store.workspaces[0].tabGroups[1];
			expect(newTabGroup[0].path).toBe('/home/user/Downloads');
			expect(newTabGroup[0].id).not.toBe(tab.id);
		});

		it('copies dirEntries from the source tab', async () => {
			const entries = [{ name: 'file.txt', path: '/home/user/Downloads/file.txt', ext: 'txt', size: 100, item_count: null, modified_time: 0, accessed_time: 0, created_time: 0, mime: null, is_file: true, is_dir: false, is_symlink: false, is_hidden: false }];
			const tab = createTab({ path: '/home/user/Downloads', dirEntries: entries as any });
			store.workspaces[0].tabGroups = [[tab]];
			store.workspaces[0].currentTabGroupIndex = 0;

			await store.duplicateTabGroup([tab]);

			const newTabGroup = store.workspaces[0].tabGroups[1];
			expect(newTabGroup[0].dirEntries).toHaveLength(1);
			expect(newTabGroup[0].dirEntries[0].name).toBe('file.txt');
		});

		it('inserts the duplicated tab adjacent (after) the source', async () => {
			const tab1 = createTab({ path: '/a', name: 'a' });
			const tab2 = createTab({ path: '/b', name: 'b' });
			const tab3 = createTab({ path: '/c', name: 'c' });
			store.workspaces[0].tabGroups = [[tab1], [tab2], [tab3]];
			store.workspaces[0].currentTabGroupIndex = 1;

			await store.duplicateTabGroup([tab2]);

			expect(store.workspaces[0].tabGroups).toHaveLength(4);
			expect(store.workspaces[0].tabGroups[2][0].path).toBe('/b');
			expect(store.workspaces[0].tabGroups[2][0].id).not.toBe(tab2.id);
		});
	});

	describe('pinTabGroup', () => {
		it('marks a tab as pinned', () => {
			const tab = createTab();
			store.workspaces[0].tabGroups = [[tab]];
			store.workspaces[0].currentTabGroupIndex = 0;

			store.pinTabGroup([tab]);

			expect(tab.isPinned).toBe(true);
			expect(tab.pinnedAt).toBeDefined();
		});

		it('moves pinned tab to the beginning of the tab bar', () => {
			const tab1 = createTab({ id: 't1', name: 'Tab1' });
			const tab2 = createTab({ id: 't2', name: 'Tab2' });
			const tab3 = createTab({ id: 't3', name: 'Tab3' });
			store.workspaces[0].tabGroups = [[tab1], [tab2], [tab3]];
			store.workspaces[0].currentTabGroupIndex = 2;

			store.pinTabGroup([tab3]);

			expect(store.workspaces[0].tabGroups[0][0].id).toBe('t3');
			expect(store.workspaces[0].tabGroups[0][0].isPinned).toBe(true);
		});

		it('places newly pinned tab after existing pinned tabs', () => {
			const tab1 = createTab({ id: 't1', isPinned: true, pinnedAt: 1000 });
			const tab2 = createTab({ id: 't2' });
			const tab3 = createTab({ id: 't3' });
			store.workspaces[0].tabGroups = [[tab1], [tab2], [tab3]];
			store.workspaces[0].currentTabGroupIndex = 0;

			store.pinTabGroup([tab3]);

			// tab1 is pinned at index 0, tab3 (newly pinned) at index 1
			expect(store.workspaces[0].tabGroups[0][0].id).toBe('t1');
			expect(store.workspaces[0].tabGroups[1][0].id).toBe('t3');
			expect(store.workspaces[0].tabGroups[1][0].isPinned).toBe(true);
		});

		it('does nothing if tab is already pinned', () => {
			const tab = createTab({ isPinned: true, pinnedAt: 1000 });
			store.workspaces[0].tabGroups = [[tab]];
			store.workspaces[0].currentTabGroupIndex = 0;

			store.pinTabGroup([tab]);

			expect(store.workspaces[0].tabGroups).toHaveLength(1);
		});
	});

	describe('unpinTabGroup', () => {
		it('removes pinned state from a tab', () => {
			const tab = createTab({ isPinned: true, pinnedAt: 1000 });
			store.workspaces[0].tabGroups = [[tab]];
			store.workspaces[0].currentTabGroupIndex = 0;

			store.unpinTabGroup([tab]);

			expect(tab.isPinned).toBe(false);
			expect(tab.pinnedAt).toBeUndefined();
		});

		it('moves unpinned tab to after the last pinned tab', () => {
			const tab1 = createTab({ id: 't1', isPinned: true, pinnedAt: 1000 });
			const tab2 = createTab({ id: 't2', isPinned: true, pinnedAt: 2000 });
			const tab3 = createTab({ id: 't3' });
			store.workspaces[0].tabGroups = [[tab1], [tab2], [tab3]];
			store.workspaces[0].currentTabGroupIndex = 0;

			store.unpinTabGroup([tab1]);

			// tab2 remains pinned at [0], tab1 (unpinned) goes after it at [1]
			expect(store.workspaces[0].tabGroups[0][0].id).toBe('t2');
			expect(store.workspaces[0].tabGroups[1][0].id).toBe('t1');
			expect(store.workspaces[0].tabGroups[1][0].isPinned).toBe(false);
		});
	});

	describe('closeTabGroup — pinned tab protection', () => {
		it('does not close a pinned tab', async () => {
			const tab1 = createTab({ id: 't1', isPinned: true, pinnedAt: 1000 });
			const tab2 = createTab({ id: 't2' });
			store.workspaces[0].tabGroups = [[tab1], [tab2]];
			store.workspaces[0].currentTabGroupIndex = 1;

			await store.closeTabGroup([tab1]);

			// tab1 should still be there
			expect(store.workspaces[0].tabGroups).toHaveLength(2);
			expect(store.workspaces[0].tabGroups[0][0].id).toBe('t1');
		});
	});

	describe('closeOtherTabGroups', () => {
		it('keeps pinned tabs when closing others', async () => {
			const pinnedTab = createTab({ id: 'pinned', isPinned: true, pinnedAt: 1000 });
			const currentTab = createTab({ id: 'current' });
			const otherTab = createTab({ id: 'other' });
			store.workspaces[0].tabGroups = [[pinnedTab], [currentTab], [otherTab]];
			store.workspaces[0].currentTabGroupIndex = 1;

			await store.closeOtherTabGroups([currentTab]);

			// Should have pinned + current
			const remainingIds = store.workspaces[0].tabGroups.map((tg) => tg[0].id);
			expect(remainingIds).toContain('pinned');
			expect(remainingIds).toContain('current');
			expect(remainingIds).not.toContain('other');
		});
	});

	describe('closeAllTabGroups', () => {
		it('keeps pinned tabs when closing all', async () => {
			const pinnedTab = createTab({ id: 'pinned', isPinned: true, pinnedAt: 1000 });
			const tab2 = createTab({ id: 't2' });
			const tab3 = createTab({ id: 't3' });
			store.workspaces[0].tabGroups = [[pinnedTab], [tab2], [tab3]];
			store.workspaces[0].currentTabGroupIndex = 1;

			await store.closeAllTabGroups();

			// Pinned tab remains, plus a new default tab
			const pinnedTabGroups = store.workspaces[0].tabGroups.filter(
				(tg) => tg[0]?.isPinned
			);
			expect(pinnedTabGroups).toHaveLength(1);
			expect(pinnedTabGroups[0][0].id).toBe('pinned');
		});

		it('creates a new home tab when no pinned tabs exist', async () => {
			const tab1 = createTab({ id: 't1' });
			const tab2 = createTab({ id: 't2' });
			store.workspaces[0].tabGroups = [[tab1], [tab2]];
			store.workspaces[0].currentTabGroupIndex = 0;

			await store.closeAllTabGroups();

			expect(store.workspaces[0].tabGroups).toHaveLength(1);
			expect(store.workspaces[0].tabGroups[0][0].path).toBe('/home/user');
		});
	});

	describe('isTabGroupPinned', () => {
		it('returns true for pinned tab groups', () => {
			const tab = createTab({ isPinned: true });
			expect(store.isTabGroupPinned([tab])).toBe(true);
		});

		it('returns false for unpinned tab groups', () => {
			const tab = createTab({ isPinned: false });
			expect(store.isTabGroupPinned([tab])).toBe(false);
		});
	});

	describe('closedTabHistory', () => {
		it('stores closed tab in history when closing a non-pinned tab', async () => {
			const tab1 = createTab({ id: 't1', path: '/home/user/Docs', name: 'Docs' });
			const tab2 = createTab({ id: 't2', path: '/home/user/Downloads', name: 'Downloads' });
			store.workspaces[0].tabGroups = [[tab1], [tab2]];
			store.workspaces[0].currentTabGroupIndex = 0;

			await store.closeTabGroup([tab2]);

			expect(store.closedTabHistory).toHaveLength(1);
			expect(store.closedTabHistory[0].path).toBe('/home/user/Downloads');
			expect(store.closedTabHistory[0].name).toBe('Downloads');
			expect(store.closedTabHistory[0].closedAt).toBeGreaterThan(0);
			expect(store.closedTabHistory[0].wasPinned).toBe(false);
		});

		it('does not store pinned tabs in history', async () => {
			const tab1 = createTab({ id: 't1', isPinned: true, pinnedAt: 1000 });
			const tab2 = createTab({ id: 't2' });
			store.workspaces[0].tabGroups = [[tab1], [tab2]];
			store.workspaces[0].currentTabGroupIndex = 1;

			await store.closeTabGroup([tab1]);

			expect(store.closedTabHistory).toHaveLength(0);
		});

		it('limits history to 20 entries', async () => {
			// Create 22 tabs and close them one by one
			const tabs = Array.from({ length: 22 }, (_, i) =>
				createTab({ id: `t${i}`, path: `/path/${i}`, name: `Tab${i}` })
			);

			for (let i = 0; i < 22; i++) {
				// Set up workspace with 2 tabs each time (need at least 2 to close properly)
				const keepTab = createTab({ id: 'keep' });
				store.workspaces[0].tabGroups = [[keepTab], [tabs[i]]];
				store.workspaces[0].currentTabGroupIndex = 0;

				await store.closeTabGroup([tabs[i]]);
			}

			expect(store.closedTabHistory.length).toBeLessThanOrEqual(20);
		});

		it('stores most recent closed tab first', async () => {
			const tab1 = createTab({ id: 't1', path: '/first', name: 'First' });
			const tab2 = createTab({ id: 't2', path: '/second', name: 'Second' });
			const keepTab = createTab({ id: 'keep' });

			store.workspaces[0].tabGroups = [[keepTab], [tab1], [tab2]];
			store.workspaces[0].currentTabGroupIndex = 0;

			await store.closeTabGroup([tab1]);
			await store.closeTabGroup([tab2]);

			expect(store.closedTabHistory[0].path).toBe('/second');
			expect(store.closedTabHistory[1].path).toBe('/first');
		});
	});

	describe('restoreLastClosedTab', () => {
		it('restores the most recently closed tab', async () => {
			const tab1 = createTab({ id: 't1', path: '/home/user/Docs', name: 'Docs' });
			const tab2 = createTab({ id: 't2', path: '/home/user/Downloads', name: 'Downloads' });
			store.workspaces[0].tabGroups = [[tab1], [tab2]];
			store.workspaces[0].currentTabGroupIndex = 0;

			await store.closeTabGroup([tab2]);
			expect(store.closedTabHistory).toHaveLength(1);

			await store.restoreLastClosedTab();

			// History should be empty now
			expect(store.closedTabHistory).toHaveLength(0);
			// A new tab with the restored path should exist
			const restoredTab = store.workspaces[0].tabGroups.find(
				(tg) => tg[0]?.path === '/home/user/Downloads'
			);
			expect(restoredTab).toBeDefined();
		});

		it('does nothing if history is empty', async () => {
			const tab1 = createTab({ id: 't1' });
			store.workspaces[0].tabGroups = [[tab1]];
			store.workspaces[0].currentTabGroupIndex = 0;

			const tabCountBefore = store.workspaces[0].tabGroups.length;

			await store.restoreLastClosedTab();

			expect(store.workspaces[0].tabGroups.length).toBe(tabCountBefore);
		});

		it('inserts restored tab adjacent to the current tab', async () => {
			const tab1 = createTab({ id: 't1', path: '/a', name: 'a' });
			const tab2 = createTab({ id: 't2', path: '/b', name: 'b' });
			const tab3 = createTab({ id: 't3', path: '/c', name: 'c' });
			store.workspaces[0].tabGroups = [[tab1], [tab2], [tab3]];
			store.workspaces[0].currentTabGroupIndex = 0;

			await store.closeTabGroup([tab3]);
			// Now we have [tab1, tab2], current is 0
			store.workspaces[0].currentTabGroupIndex = 1; // set current to tab2

			await store.restoreLastClosedTab();

			// Restored tab should be at index 2 (after current tab2 at index 1)
			expect(store.workspaces[0].tabGroups[2][0].path).toBe('/c');
		});
	});
});
