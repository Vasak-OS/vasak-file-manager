import { invoke } from '@tauri-apps/api/core';
import { basename } from '@tauri-apps/api/path';
import { LazyStore } from '@tauri-apps/plugin-store';
import { defineStore } from 'pinia';
import type { ComputedRef } from 'vue';
import { computed, ref, watch } from 'vue';
import { useNavigatorStore } from '@/stores/runtime/navigator';
import {
	migrateWorkspacesStorage,
	parseWorkspaces,
	WORKSPACES_SCHEMA_VERSION,
	WORKSPACES_SCHEMA_VERSION_KEY,
} from '@/stores/scheme/workspaces';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import type { DirEntry } from '@/types/dir-entry';
import type { Tab, TabGroup, Workspace } from '@/types/workspaces';
import { replacePathPrefix } from '@/utils/path';
import clone from '@/utils/clone';
import { useDebounceFn } from '@/utils/debounce';
import uniqueId from '@/utils/unique-id';

export interface ClosedTabHistoryEntry {
	path: string;
	name: string;
	closedAt: number;
	wasPinned: boolean;
}

const CLOSED_TAB_HISTORY_MAX = 20;

export const useWorkspacesStore = defineStore('workspaces', () => {
	const userPathsStore = useUserPathsStore();
	const navigatorStore = useNavigatorStore();

	const workspacesStorage = ref<LazyStore | null>(null);
	const isInitialized = ref(false);
	const workspaces = ref<Workspace[]>(createDefaultWorkspaces());
	const closedTabHistory = ref<ClosedTabHistoryEntry[]>([]);

	/** Path to navigate the active tab to. Set by navigateCurrentTab, consumed by NavigatorBarComponent. */
	const pendingNavigationPath = ref<string | null>(null);

	const primaryWorkspace: ComputedRef<Workspace | null> = computed(
		() => workspaces.value?.find((workspace) => workspace.isPrimary) || null
	);

	const currentWorkspace: ComputedRef<Workspace | null> = computed(
		() => workspaces.value?.find((workspace) => workspace.isCurrent) || null
	);

	const currentTabGroup: ComputedRef<TabGroup | null> = computed(
		() =>
			currentWorkspace?.value?.tabGroups[currentWorkspace?.value?.currentTabGroupIndex || 0] || null
	);

	const currentTab: ComputedRef<Tab | null> = computed(() => {
		const tabGroup = currentTabGroup?.value;
		if (!tabGroup?.length) {
			return null;
		}

		const index = currentWorkspace?.value?.currentTabIndex ?? 0;
		return tabGroup[index] ?? tabGroup[0] ?? null;
	});

	const tabGroupCount: ComputedRef<number> = computed(
		() => currentWorkspace.value?.tabGroups?.length || 0
	);

	const tabs: ComputedRef<Tab[]> = computed(() => currentWorkspace.value?.tabGroups?.flat() || []);

	watch(
		() => currentWorkspace?.value?.tabGroups?.length,
		(value) => {
			if (value === 0) {
				preloadDefaultTab();
			}
		}
	);

	function getCurrentTabGroup(workspace: Workspace) {
		return workspace.tabGroups[workspace.currentTabGroupIndex || 0];
	}

	function getTabGroupIndex(workspace: Workspace | null, tabGroup: TabGroup): number | undefined {
		return workspace?.tabGroups?.findIndex((_tabGroup: TabGroup) =>
			_tabGroup.some((_tab: Tab) => _tab.id === tabGroup[0].id)
		);
	}

	function createDefaultWorkspaces(): Workspace[] {
		return [
			{
				id: 0,
				isPrimary: true,
				isCurrent: true,
				name: 'primary',
				actions: [],
				tabGroups: [],
				currentTabGroupIndex: 0,
				currentTabIndex: 0,
			},
		];
	}

	async function createNewTab(path?: string): Promise<Tab> {
		const tabPath = path || userPathsStore.userPaths.homeDir;
		let tabName: string;

		try {
			tabName = await basename(tabPath);
		} catch {
			tabName = tabPath;
		}

		return {
			id: uniqueId(),
			name: tabName,
			path: tabPath,
			type: 'directory',
			paneWidth: 100,
			filterQuery: '',
			dirEntries: [],
			selectedDirEntries: [],
		};
	}

	async function preloadDefaultTab() {
		await addNewTabGroup();

		if (currentTabGroup.value) {
			openTabGroup(currentTabGroup.value);
		}
	}

	function addTabGroup(tabGroup: Tab[]) {
		currentWorkspace.value?.tabGroups?.push(tabGroup);
	}

	async function closeTabGroup(tabGroup: Tab[]) {
		// Prevent closing pinned tabs
		if (tabGroup[0]?.isPinned) {
			return;
		}

		// Store in closed tab history before removing
		const tabToClose = tabGroup[0];
		if (tabToClose) {
			addToClosedTabHistory({
				path: tabToClose.path,
				name: tabToClose.name,
				closedAt: Date.now(),
				wasPinned: tabToClose.isPinned === true,
			});
		}

		if (tabGroupCount.value <= 1) {
			await closeAllTabGroups();
			return;
		}

		const initialCurrentTabGroupIndex = currentWorkspace.value?.currentTabGroupIndex ?? -1;
		const isInitialClosingTabGroupCurrent = currentTabGroup.value?.[0]?.id === tabGroup[0].id;
		const initialClosingTabGroupIndex = currentWorkspace.value?.tabGroups?.findIndex(
			(_tabGroup) => _tabGroup[0].id === tabGroup[0].id
		);
		const initialLastTabIndex = tabGroupCount.value - 1;

		if (typeof initialClosingTabGroupIndex === 'number' && initialClosingTabGroupIndex !== -1) {
			const previousTabGroupIndex = Math.max(0, initialClosingTabGroupIndex);
			currentWorkspace.value?.tabGroups?.splice(initialClosingTabGroupIndex, 1);
			setCurrentTabGroupAfterClosing({
				initialCurrentTabGroupIndex,
				isInitialClosingTabGroupCurrent,
				initialLastTabIndex,
				previousTabGroupIndex,
				initialClosingTabGroupIndex,
			});
		}
	}

	async function closeAllTabGroups() {
		if (!currentWorkspace.value) {
			return;
		}

		// Keep pinned tabs
		const pinnedTabGroups = currentWorkspace.value.tabGroups.filter(
			(tg) => tg[0]?.isPinned
		);

		if (pinnedTabGroups.length > 0) {
			const newTab = await createNewTab();
			const newTabGroup = [newTab];
			currentWorkspace.value.tabGroups = [...pinnedTabGroups, newTabGroup];
			currentWorkspace.value.currentTabGroupIndex = pinnedTabGroups.length;
			currentWorkspace.value.currentTabIndex = 0;
			try {
				await openTabGroup(newTabGroup);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to open new tab group: ${errorMessage}`);
			}
		} else {
			const newTab = await createNewTab();
			const newTabGroup = [newTab];
			currentWorkspace.value.tabGroups = [newTabGroup];
			currentWorkspace.value.currentTabGroupIndex = 0;
			currentWorkspace.value.currentTabIndex = 0;
			try {
				await openTabGroup(newTabGroup);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Failed to open new tab group: ${errorMessage}`);
			}
		}
	}

	async function closeOtherTabGroups(keepTabGroup?: Tab[]) {
		if (!currentWorkspace.value) {
			return;
		}

		const tabGroupToKeep = keepTabGroup || currentTabGroup.value;

		if (!tabGroupToKeep) {
			return;
		}

		// Keep pinned tabs and the specified tab group
		const pinnedTabGroups = currentWorkspace.value.tabGroups.filter(
			(tg) => tg[0]?.isPinned && tg[0]?.id !== tabGroupToKeep[0]?.id
		);

		const tabGroupCopy = [...tabGroupToKeep];
		currentWorkspace.value.tabGroups = [...pinnedTabGroups, tabGroupCopy];
		const newIndex = currentWorkspace.value.tabGroups.findIndex(
			(tg) => tg[0]?.id === tabGroupCopy[0]?.id
		);
		currentWorkspace.value.currentTabGroupIndex = newIndex !== -1 ? newIndex : 0;
		currentWorkspace.value.currentTabIndex = 0;
		try {
			await openTabGroup(tabGroupCopy);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`Failed to open kept tab group: ${errorMessage}`);
		}
	}

	async function duplicateTabGroup(tabGroup: TabGroup) {
		if (!currentWorkspace.value) {
			return;
		}

		const sourceTab = tabGroup[0];
		if (!sourceTab) return;

		const newTab = await createNewTab(sourceTab.path);
		newTab.type = sourceTab.type;
		newTab.filterQuery = sourceTab.filterQuery;
		newTab.dirEntries = [...sourceTab.dirEntries];

		const newTabGroup: TabGroup = [newTab];

		// Insert adjacent to the source tab group
		const sourceIndex = getTabGroupIndex(currentWorkspace.value, tabGroup);
		if (typeof sourceIndex === 'number' && sourceIndex !== -1) {
			currentWorkspace.value.tabGroups.splice(sourceIndex + 1, 0, newTabGroup);
		} else {
			currentWorkspace.value.tabGroups.push(newTabGroup);
		}

		await openTabGroup(newTabGroup);
	}

	function pinTabGroup(tabGroup: TabGroup) {
		if (!currentWorkspace.value) return;

		const tab = tabGroup[0];
		if (!tab || tab.isPinned) return;

		tab.isPinned = true;
		tab.pinnedAt = Date.now();

		// Move to start (after other pinned tabs)
		const tabGroupIndex = getTabGroupIndex(currentWorkspace.value, tabGroup);
		if (typeof tabGroupIndex !== 'number' || tabGroupIndex === -1) return;

		// Remove from current position
		currentWorkspace.value.tabGroups.splice(tabGroupIndex, 1);

		// Find insertion point (after last pinned tab)
		const lastPinnedIndex = currentWorkspace.value.tabGroups.reduce(
			(lastIdx, tg, idx) => (tg[0]?.isPinned ? idx : lastIdx),
			-1
		);

		const insertIndex = lastPinnedIndex + 1;
		currentWorkspace.value.tabGroups.splice(insertIndex, 0, tabGroup);

		// Update currentTabGroupIndex to follow the current tab
		const currentId = currentTabGroup.value?.[0]?.id;
		if (currentId) {
			const newCurrentIndex = currentWorkspace.value.tabGroups.findIndex(
				(tg) => tg[0]?.id === currentId
			);
			if (newCurrentIndex !== -1) {
				currentWorkspace.value.currentTabGroupIndex = newCurrentIndex;
			}
		}
	}

	function unpinTabGroup(tabGroup: TabGroup) {
		if (!currentWorkspace.value) return;

		const tab = tabGroup[0];
		if (!tab?.isPinned) return;

		tab.isPinned = false;
		tab.pinnedAt = undefined;

		// Move after last pinned tab (first non-pinned position)
		const tabGroupIndex = getTabGroupIndex(currentWorkspace.value, tabGroup);
		if (typeof tabGroupIndex !== 'number' || tabGroupIndex === -1) return;

		// Remove from current position
		currentWorkspace.value.tabGroups.splice(tabGroupIndex, 1);

		// Find insertion point (after last pinned tab)
		const lastPinnedIndex = currentWorkspace.value.tabGroups.reduce(
			(lastIdx, tg, idx) => (tg[0]?.isPinned ? idx : lastIdx),
			-1
		);

		const insertIndex = lastPinnedIndex + 1;
		currentWorkspace.value.tabGroups.splice(insertIndex, 0, tabGroup);

		// Update currentTabGroupIndex to follow the current tab
		const currentId = currentTabGroup.value?.[0]?.id;
		if (currentId) {
			const newCurrentIndex = currentWorkspace.value.tabGroups.findIndex(
				(tg) => tg[0]?.id === currentId
			);
			if (newCurrentIndex !== -1) {
				currentWorkspace.value.currentTabGroupIndex = newCurrentIndex;
			}
		}
	}

	function isTabGroupPinned(tabGroup: TabGroup): boolean {
		return tabGroup[0]?.isPinned === true;
	}

	function addToClosedTabHistory(entry: ClosedTabHistoryEntry) {
		closedTabHistory.value.unshift(entry);
		if (closedTabHistory.value.length > CLOSED_TAB_HISTORY_MAX) {
			closedTabHistory.value = closedTabHistory.value.slice(0, CLOSED_TAB_HISTORY_MAX);
		}
	}

	async function restoreLastClosedTab() {
		if (closedTabHistory.value.length === 0) {
			return;
		}

		const entry = closedTabHistory.value.shift()!;
		const currentIndex = currentWorkspace.value?.currentTabGroupIndex ?? 0;

		const newTab = await createNewTab(entry.path);
		const newTabGroup: TabGroup = [newTab];

		// Insert adjacent to the current tab (after it)
		if (currentWorkspace.value) {
			currentWorkspace.value.tabGroups.splice(currentIndex + 1, 0, newTabGroup);
			await openTabGroup(newTabGroup);
		}
	}

	function setCurrentTabGroupAfterClosing(params: {
		initialCurrentTabGroupIndex: number;
		isInitialClosingTabGroupCurrent: boolean;
		initialLastTabIndex: number;
		previousTabGroupIndex: number;
		initialClosingTabGroupIndex: number;
	}) {
		const {
			initialCurrentTabGroupIndex,
			isInitialClosingTabGroupCurrent,
			initialLastTabIndex,
			previousTabGroupIndex,
			initialClosingTabGroupIndex,
		} = params;

		if (isInitialClosingTabGroupCurrent) {
			if (initialClosingTabGroupIndex < tabGroupCount.value) {
				setCurrentTabGroupIndex(previousTabGroupIndex);
				setCurrentTabIndex(0);
			} else {
				setCurrentTabGroupIndex(previousTabGroupIndex - 1);
				setCurrentTabIndex(0);
			}
		} else {
			if (initialClosingTabGroupIndex < initialCurrentTabGroupIndex) {
				if (initialCurrentTabGroupIndex === initialLastTabIndex) {
					setCurrentTabGroupIndex(tabGroupCount.value - 1);
					setCurrentTabIndex(0);
				}
			}
		}
	}

	function closeTab(workspace: Workspace, tabGroupIndex: number, tabIndex: number) {
		const tabGroup = workspace.tabGroups[tabGroupIndex];

		if (tabGroup) {
			workspace.tabGroups[tabGroupIndex] = tabGroup.filter((_, i) => i !== tabIndex);
			setCurrentTabIndex(0);
		}
	}

	async function addNewTabGroup(path?: string) {
		const newTab = await createNewTab(path);
		const newTabGroup = [newTab];
		addTabGroup(newTabGroup);
		return newTabGroup;
	}

	async function openNewTabGroup(path?: string) {
		const newTabGroup = await addNewTabGroup(path);
		openTabGroup(newTabGroup);
	}

	/**
	 * Navigate the current active tab to a new path without creating a new tab.
	 * Sets a pending navigation path that the NavigatorBarComponent will pick up.
	 */
	async function navigateCurrentTab(path: string) {
		const tab = currentTab.value;
		if (!tab) {
			// Fallback: open new tab if no active tab
			await openNewTabGroup(path);
			return;
		}

		pendingNavigationPath.value = path;
	}

	function setTabFilterQuery(tab: Tab, filterQuery: string) {
		tab.filterQuery = filterQuery;
	}

	function setCurrentTabGroupIndex(newTabGroupGroupIndex: number) {
		const index = Math.max(0, newTabGroupGroupIndex);

		if (currentWorkspace.value?.tabGroups[index]) {
			currentWorkspace.value.currentTabGroupIndex = index;
		}
	}

	function setCurrentTabIndex(newTabGroupIndex: number) {
		const index = Math.max(0, newTabGroupIndex);

		if (currentWorkspace.value) {
			currentWorkspace.value.currentTabIndex = index;
		}
	}

	async function setTabs(tabGroups: TabGroup[]) {
		let currentTabGroupId = '';

		if (!tabGroups.length) {
			return;
		}

		if (currentTabGroup.value) {
			currentTabGroupId = currentTab?.value?.id ?? '';
		}

		if (currentWorkspace.value) {
			currentWorkspace.value.tabGroups = tabGroups;
		}

		const newCurrentTabGroupIndex =
			currentWorkspace.value?.tabGroups?.findIndex((_tabGroup) =>
				_tabGroup.some((tab) => tab.id === currentTabGroupId)
			) ?? -1;
		setCurrentTabGroupIndex(newCurrentTabGroupIndex);
	}

	async function loadTabGroupDirEntries(tabGroup: TabGroup) {
		const { useDirectoryCacheStore } = await import('@/stores/runtime/directory-cache');
		const directoryCache = useDirectoryCacheStore();

		await Promise.all(
			tabGroup.map(async (tab: Tab) => {
				if (tab.type === 'directory') {
					// Requirement 5.2: If the tab already has dirEntries in memory
					// or the directory is in cache, skip the backend call
					if (tab.dirEntries && tab.dirEntries.length > 0) {
						return;
					}

					const cached = directoryCache.get(tab.path);
					if (cached) {
						tab.dirEntries = cached.entries;
						return;
					}

					const dirEntries = await getDirEntries({ path: tab.path });
					tab.dirEntries = dirEntries;
				}
			})
		);
	}

	async function openTabGroup(tabGroup: TabGroup) {
		try {
			const tabGroupIndex = getTabGroupIndex(currentWorkspace.value, tabGroup);

			if (
				typeof tabGroupIndex !== 'number' ||
				tabGroupIndex === -1 ||
				!checkTabGroupExists(tabGroup)
			) {
				throw Error("Tab doesn't exist");
			}

			setCurrentTabGroupIndex(tabGroupIndex);
			await loadTabGroupDirEntries(tabGroup);
			updateInfoPanel(tabGroup);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			throw Error(`Could not open tab: ${errorMessage}`);
		}
	}

	async function updateInfoPanel(tabGroup: TabGroup) {
		const dirEntry = await getDirEntry({ path: tabGroup[0].path });
		await navigatorStore.updateInfoPanel(dirEntry);
	}

	function checkTabGroupExists(tabGroup: TabGroup) {
		return tabGroup.some((tab) => tabs.value.some((_tab: Tab) => _tab.id === tab.id));
	}

	async function getDirEntry(params: { path: string | null }): Promise<DirEntry | null> {
		try {
			if (!params.path) {
				return null;
			}

			const dirEntry = (await invoke('get_dir_entry', { path: params.path })) satisfies DirEntry;
			return dirEntry;
		} catch {
			return null;
		}
	}

	async function getDirEntries(params: { path: string }): Promise<DirEntry[]> {
		try {
			const dirEntries = (await invoke('get_dir_entries', {
				path: params.path,
			})) satisfies DirEntry[];
			return dirEntries;
		} catch {
			return [];
		}
	}

	function isTabGroupSplit(tabGroup: TabGroup | undefined): boolean {
		return (tabGroup?.length ?? 0) > 1;
	}

	function toggleSplitView() {
		if (!currentWorkspace.value) return;
		const workspace = currentWorkspace.value;
		const tabGroup = getCurrentTabGroup(workspace);
		if (!tabGroup) return;

		if (isTabGroupSplit(tabGroup)) {
			disableSplitView(workspace, tabGroup);
		} else {
			enableSplitView(workspace, tabGroup);
		}
	}

	function disableSplitView(workspace: Workspace, tabGroup: TabGroup) {
		closeTab(workspace, workspace.currentTabGroupIndex, tabGroup.length - 1);
		const remaining = workspace.tabGroups[workspace.currentTabGroupIndex || 0];
		if (remaining) adjustSplitViewPanes(remaining);
	}

	function enableSplitView(workspace: Workspace, tabGroup: TabGroup) {
		if (tabGroup.length >= 2) return;
		splitTabGroup(workspace, tabGroup);
		const updated = workspace.tabGroups[workspace.currentTabGroupIndex || 0];
		if (updated) adjustSplitViewPanes(updated);
	}

	function splitTabGroup(workspace: Workspace, tabGroup: TabGroup) {
		const source = tabGroup[0];
		const newTab: Tab = {
			...clone(source),
			id: uniqueId(),
			dirEntries: [],
			selectedDirEntries: [],
		};
		const index = workspace.currentTabGroupIndex || 0;
		workspace.tabGroups[index] = [...tabGroup, newTab];
	}

	function adjustSplitViewPanes(tabGroup: TabGroup) {
		tabGroup.forEach((tab: Tab) => {
			tab.paneWidth = Math.round(100 / (tabGroup.length || 1));
		});
	}

	const lastRenamedPath = ref<{
		oldPath: string;
		newPath: string;
	} | null>(null);
	const lastDeletedPaths = ref<string[] | null>(null);

	function handlePathRenamed(oldPath: string, newPath: string) {
		for (const workspace of workspaces.value) {
			for (const tabGroup of workspace.tabGroups) {
				for (const tab of tabGroup) {
					const updatedPath = replacePathPrefix(tab.path, oldPath, newPath);

					if (updatedPath !== null) {
						tab.path = updatedPath;
						const pathParts = updatedPath.split('/').filter(Boolean);
						tab.name = pathParts[pathParts.length - 1] || updatedPath;
					}
				}
			}
		}

		lastRenamedPath.value = {
			oldPath,
			newPath,
		};
	}

	function handlePathsDeleted(paths: string[]) {
		const homePath = userPathsStore.userPaths.homeDir;
		const homePathParts = homePath.split('/').filter(Boolean);
		const homeName = homePathParts[homePathParts.length - 1] || homePath;

		for (const workspace of workspaces.value) {
			for (const tabGroup of workspace.tabGroups) {
				for (const tab of tabGroup) {
					const isAffected = paths.some(
						(deletedPath) => tab.path === deletedPath || tab.path.startsWith(`${deletedPath}/`)
					);

					if (isAffected) {
						tab.path = homePath;
						tab.name = homeName;
					}
				}
			}
		}

		lastDeletedPaths.value = paths;
	}

	async function initStorage() {
		try {
			if (!workspacesStorage.value) {
				workspacesStorage.value = new LazyStore(
					userPathsStore.customPaths.appUserDataWorkspacesPath
				);
				await workspacesStorage.value.save();
			}
		} catch (error) {
			console.error('Failed to initialize workspaces storage:', error);
		}
	}

	async function loadWorkspaces() {
		try {
			const storedWorkspacesValue = await workspacesStorage.value?.get<unknown>('workspaces');
			const storedCurrentTabGroupIndex =
				await workspacesStorage.value?.get<number>('currentTabGroupIndex');
			const storedWorkspaces = storedWorkspacesValue
				? parseWorkspaces(storedWorkspacesValue)
				: null;

			if (!storedWorkspaces) {
				return false;
			}

			workspaces.value = storedWorkspaces;

			if (
				typeof storedCurrentTabGroupIndex === 'number' &&
				Number.isFinite(storedCurrentTabGroupIndex)
			) {
				setCurrentTabGroupIndex(storedCurrentTabGroupIndex);
			}

			return true;
		} catch (error) {
			console.error('Failed to load workspaces:', error);
			return false;
		}
	}

	async function saveWorkspaces() {
		try {
			if (workspacesStorage.value && isInitialized.value) {
				const workspacesToSave = workspaces.value.map((workspace) => ({
					...workspace,
					tabGroups: workspace.tabGroups.map((tabGroup) =>
						tabGroup.map((tab) => ({
							...tab,
							dirEntries: [],
							selectedDirEntries: [],
						}))
					),
				}));

				await workspacesStorage.value.set(WORKSPACES_SCHEMA_VERSION_KEY, WORKSPACES_SCHEMA_VERSION);
				await workspacesStorage.value.set('workspaces', workspacesToSave);
				await workspacesStorage.value.set(
					'currentTabGroupIndex',
					currentWorkspace.value?.currentTabGroupIndex ?? 0
				);
				await workspacesStorage.value.save();
			}
		} catch (error) {
			console.error('Failed to save workspaces:', error);
		}
	}

	const debouncedSaveWorkspaces = useDebounceFn(saveWorkspaces, 300);

	watch(
		() => workspaces.value,
		() => {
			debouncedSaveWorkspaces();
		},
		{ deep: true }
	);

	async function init() {
		try {
			await initStorage();

			if (workspacesStorage.value) {
				await migrateWorkspacesStorage(workspacesStorage.value);
			}

			const loaded = await loadWorkspaces();

			if (!loaded) {
				await preloadDefaultTab();
			}

			if (!currentWorkspace.value) {
				const firstWorkspace = workspaces.value[0];
				if (firstWorkspace) {
					firstWorkspace.isCurrent = true;
				}
			}

			if (!currentWorkspace.value?.tabGroups?.length) {
				await preloadDefaultTab();
			}

			if (
				currentWorkspace.value &&
				!currentTabGroup.value &&
				currentWorkspace.value.tabGroups.length > 0
			) {
				currentWorkspace.value.currentTabGroupIndex = 0;
				currentWorkspace.value.currentTabIndex = 0;
			}

			isInitialized.value = true;

			if (currentTabGroup.value) {
				await openTabGroup(currentTabGroup.value);
			}
		} catch (error) {
			console.error('Failed to initialize workspaces:', error);
			isInitialized.value = true;
		}
	}

	return {
		workspaces,
		primaryWorkspace,
		currentWorkspace,
		tabs,
		currentTabGroup,
		currentTab,
		closedTabHistory,
		pendingNavigationPath,
		init,
		addNewTabGroup,
		openNewTabGroup,
		navigateCurrentTab,
		preloadDefaultTab,
		getDirEntry,
		openTabGroup,
		closeTabGroup,
		closeAllTabGroups,
		closeOtherTabGroups,
		duplicateTabGroup,
		pinTabGroup,
		unpinTabGroup,
		isTabGroupPinned,
		restoreLastClosedTab,
		setTabs,
		toggleSplitView,
		setTabFilterQuery,
		lastRenamedPath,
		handlePathRenamed,
		lastDeletedPaths,
		handlePathsDeleted,
	};
});
