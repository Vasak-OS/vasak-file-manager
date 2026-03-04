<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import FileBrowserComponent from '@/components/filebrowser/FileBrowserComponent.vue';
import ClipboardToolbarComponent from '@/components/navigator/ClipboardToolbarComponent.vue';
import ResizableHandle from '@/components/ui/ResizableHandle.vue';
import ResizablePanel from '@/components/ui/ResizablePanel.vue';
import ResizablePanelGroup from '@/components/ui/ResizablePanelGroup.vue';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import { useDismissalLayerStore } from '@/stores/runtime/dismissal-layer';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useTerminalsStore } from '@/stores/runtime/terminals';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import { useUserLayoutStore } from '@/stores/storage/user-layout';
import type { DirEntry } from '@/types/dir-entry';
import type { Layout } from '@/types/navigator';
import GlobalSearchView from '@/views/GlobalSearchView.vue';

type FileBrowserInstance = InstanceType<typeof FileBrowserComponent> & {
	navigateToPath?: (path: string) => Promise<void>;
	openFile?: (path: string) => Promise<void>;
	startRename?: (entry: DirEntry) => void;
	selectFirstEntry?: () => Promise<void>;
	navigateUp?: () => void;
	navigateDown?: () => void;
	navigateLeft?: () => void;
	navigateRight?: () => void;
	openSelected?: () => void;
	navigateBack?: () => void;
};

type GlobalSearchViewInstance = InstanceType<typeof GlobalSearchView> & {
	getActiveFileBrowser?: () => FileBrowserInstance | undefined;
	clearSelections?: () => void;
};

const emit = defineEmits<{
	'update:selected-entries': [entries: DirEntry[]];
	'update:current-dir-entry': [entry: DirEntry | null];
}>();

const workspacesStore = useWorkspacesStore();
const clipboardStore = useClipboardStore();
const dismissalLayerStore = useDismissalLayerStore();
const globalSearchStore = useGlobalSearchStore();
const shortcutsStore = useShortcutsStore();
const terminalsStore = useTerminalsStore();
const dirSizesStore = useDirSizesStore();
const userLayoutStore = useUserLayoutStore();
const paneRefsMap = ref<Map<string, FileBrowserInstance>>(new Map());
const singlePaneRef = ref<FileBrowserInstance | null>(null);
const globalSearchViewRef = ref<GlobalSearchViewInstance | null>(null);
const isSearchSelectionActive = ref(false);
const selectedEntries = ref<DirEntry[]>([]);
const currentDirEntry = ref<DirEntry | null>(null);
const activeTabId = ref<string | null>(null);

const smallScreenMediaQuery = window.matchMedia(`(max-width: 800px)`);
const isSmallScreen = ref(smallScreenMediaQuery.matches);

watch(
	() => workspacesStore.currentTabGroup,
	() => {
		const currentTabIds = new Set(workspacesStore.currentTabGroup?.map((tab) => tab.id) || []);

		for (const tabId of paneRefsMap.value.keys()) {
			if (!currentTabIds.has(tabId)) {
				paneRefsMap.value.delete(tabId);
			}
		}
	}
);

function handleSmallScreenChange(event: MediaQueryListEvent) {
	isSmallScreen.value = event.matches;
}

const currentLayout = computed<Layout>(() => {
	return userLayoutStore.layout;
});

const isSplitView = computed(() => {
	return (workspacesStore.currentTabGroup?.length ?? 0) > 1;
});

const currentActivePath = computed(() => {
	return currentDirEntry.value?.path;
});

const wasSplitViewBeforeSearch = ref(false);

watch(
	() => globalSearchStore.isOpen,
	(isOpen) => {
		if (isOpen) {
			wasSplitViewBeforeSearch.value = isSplitView.value;

			if (isSplitView.value) {
				workspacesStore.toggleSplitView();
			}
		} else {
			if (wasSplitViewBeforeSearch.value && !isSplitView.value) {
				workspacesStore.toggleSplitView();
			}

			if (isSearchSelectionActive.value) {
				isSearchSelectionActive.value = false;
				selectedEntries.value = [];
			}
		}
	}
);

function handleSelectionChange(entries: DirEntry[], tabId?: string) {
	if (entries.length > 0) {
		isSearchSelectionActive.value = false;
		globalSearchViewRef.value?.clearSelections?.();
		selectedEntries.value = entries;
		emit('update:selected-entries', entries);

		if (tabId) {
			activeTabId.value = tabId;

			paneRefsMap.value.forEach((pane, paneTabId) => {
				if (paneTabId !== tabId) {
					pane.clearSelection();
				}
			});
		}
	} else if (!isSearchSelectionActive.value && (!tabId || tabId === activeTabId.value)) {
		selectedEntries.value = [];
		emit('update:selected-entries', []);
	}
}

function handleSearchSelectionChange(entries: DirEntry[]) {
	if (entries.length > 0) {
		isSearchSelectionActive.value = true;
		selectedEntries.value = entries;
		emit('update:selected-entries', entries);

		paneRefsMap.value.forEach((pane) => {
			pane.clearSelection();
		});

		if (singlePaneRef.value) {
			singlePaneRef.value.clearSelection();
		}
	} else {
		isSearchSelectionActive.value = false;
		selectedEntries.value = [];
		emit('update:selected-entries', []);
	}
}

function handleCurrentDirChange(entry: DirEntry | null) {
	currentDirEntry.value = entry;
	emit('update:current-dir-entry', entry);
}

function handlePaneFocus(tabId: string) {
	activeTabId.value = tabId;
}

function setPaneRef(element: FileBrowserInstance | null, tabId: string) {
	if (element) {
		paneRefsMap.value.set(tabId, element);
	} else {
		paneRefsMap.value.delete(tabId);
	}
}

function getFilterState(pane: FileBrowserInstance): boolean {
	const state = pane.isFilterOpen;

	if (typeof state === 'object' && state !== null && 'value' in state) {
		return Boolean((state as { value: boolean }).value);
	}

	return Boolean(state);
}

function getActivePaneRef(): FileBrowserInstance | undefined {
	if (isSearchSelectionActive.value && globalSearchStore.isOpen) {
		const searchFileBrowser = globalSearchViewRef.value?.getActiveFileBrowser?.();

		if (searchFileBrowser) {
			return searchFileBrowser;
		}
	}

	if (!isSplitView.value) {
		const currentTabId = workspacesStore.currentTabGroup?.[0]?.id;

		if (currentTabId && paneRefsMap.value.has(currentTabId)) {
			return paneRefsMap.value.get(currentTabId);
		}

		return singlePaneRef.value || undefined;
	}

	if (activeTabId.value && paneRefsMap.value.has(activeTabId.value)) {
		return paneRefsMap.value.get(activeTabId.value);
	}

	const firstCurrentTabId = workspacesStore.currentTabGroup?.[0]?.id;

	if (firstCurrentTabId && paneRefsMap.value.has(firstCurrentTabId)) {
		return paneRefsMap.value.get(firstCurrentTabId);
	}

	return undefined;
}

function getPasteTargetPath(): string | undefined {
	if (isSplitView.value && activeTabId.value) {
		const activeTab = workspacesStore.currentTabGroup?.find((tab) => tab.id === activeTabId.value);

		if (activeTab?.path) {
			return activeTab.path;
		}
	}

	return workspacesStore.currentTabGroup?.[0]?.path;
}

async function handleGlobalSearchOpenEntry(entry: DirEntry) {
	const pane = getActivePaneRef();
	if (!pane) return;

	if (entry.is_dir && pane.navigateToPath) {
		await pane.navigateToPath(entry.path);
	} else if (entry.is_file && pane.openFile) {
		await pane.openFile(entry.path);
	}

	globalSearchStore.close();
}

function handleFilterShortcut() {
	if (!isSplitView.value) {
		const pane = singlePaneRef.value || Array.from(paneRefsMap.value.values())[0];

		if (pane) {
			pane.toggleFilter();
		}

		return;
	}

	const tabGroup = workspacesStore.currentTabGroup;

	if (!tabGroup || tabGroup.length < 2) return;

	const firstPane = paneRefsMap.value.get(tabGroup[0].id);
	const secondPane = paneRefsMap.value.get(tabGroup[1].id);

	if (!firstPane || !secondPane) return;

	const firstOpen = getFilterState(firstPane);
	const secondOpen = getFilterState(secondPane);

	if (!firstOpen && !secondOpen) {
		firstPane.openFilter();
	} else if (firstOpen && !secondOpen) {
		firstPane.closeFilter();
		setTimeout(() => {
			secondPane.openFilter();
		}, 50);
	} else {
		secondPane.closeFilter();
	}
}

function handleCopyShortcut() {
	const pane = getActivePaneRef();
	if (!pane) return;

	if (selectedEntries.value.length > 0) {
		pane.copyItems(selectedEntries.value);
	}
}

function handleCutShortcut() {
	const pane = getActivePaneRef();
	if (!pane) return;

	if (selectedEntries.value.length > 0) {
		pane.cutItems(selectedEntries.value);
	}
}

async function handlePasteShortcut() {
	const pane = getActivePaneRef();

	if (pane && clipboardStore.hasItems) {
		await pane.pasteItems(getPasteTargetPath());
	}
}

async function handlePasteToPane(paneIndex: number) {
	const tabGroup = workspacesStore.currentTabGroup;
	if (!tabGroup || !clipboardStore.hasItems) return;

	const tab = tabGroup[paneIndex];
	if (!tab) return;

	const pane = paneRefsMap.value.get(tab.id);

	if (pane) {
		await pane.pasteItems(tab.path);
	}
}

function handleSelectAllShortcut() {
	const pane = getActivePaneRef();

	if (pane) {
		pane.selectAll();
	}
}

async function handleDeleteShortcut() {
	const pane = getActivePaneRef();
	if (!pane) return;

	if (selectedEntries.value.length > 0) {
		await pane.deleteItems(selectedEntries.value, true);
	}
}

async function handleDeletePermanentlyShortcut() {
	const pane = getActivePaneRef();
	if (!pane) return;

	if (selectedEntries.value.length > 0) {
		await pane.deleteItems(selectedEntries.value, false);
	}
}

function clearAllSelections() {
	selectedEntries.value = [];
	paneRefsMap.value.forEach((pane) => {
		pane.clearSelection();
	});

	if (singlePaneRef.value) {
		singlePaneRef.value.clearSelection();
	}
}

function handleEscapeKey(): boolean {
	const hasRekaDismissableLayers = document.querySelectorAll('[data-dismissable-layer]').length > 0;

	if (hasRekaDismissableLayers) {
		return false;
	}

	if (dismissalLayerStore.hasLayers) {
		return dismissalLayerStore.dismissTopLayer();
	}

	if (clipboardStore.hasItems) {
		clipboardStore.clearClipboard();
		return true;
	}

	if (selectedEntries.value.length > 0) {
		clearAllSelections();
		return true;
	}

	return false;
}

function hasSelectedItems(): boolean {
	return selectedEntries.value.length > 0;
}

async function handleQuickViewShortcut() {
	const pane = getActivePaneRef();

	if (pane && selectedEntries.value.length > 0) {
		const lastSelected = selectedEntries.value[selectedEntries.value.length - 1];

		if (lastSelected.is_file) {
			await pane.quickView(lastSelected);
		}
	}
}

async function openTerminalWithOptions(asAdmin: boolean) {
	if (!currentActivePath.value) return;

	const defaultTerminal = terminalsStore.terminals[0];
	if (!defaultTerminal) return;

	await terminalsStore.openTerminal(currentActivePath.value, defaultTerminal.id, asAdmin);
}

async function handleOpenNewTabShortcut() {
	await workspacesStore.openNewTabGroup(currentActivePath.value);
}

async function handleOpenTerminalShortcut() {
	await openTerminalWithOptions(false);
}

async function handleOpenTerminalAdminShortcut() {
	await openTerminalWithOptions(true);
}

function switchToPane(paneIndex: number): boolean {
	if (!isSplitView.value) return false;

	const tabGroup = workspacesStore.currentTabGroup;

	if (!tabGroup || !tabGroup[paneIndex]) return false;

	const targetTab = tabGroup[paneIndex];
	activeTabId.value = targetTab.id;

	paneRefsMap.value.forEach((pane, tabId) => {
		if (tabId !== targetTab.id) {
			pane.clearSelection();
		}
	});

	const targetPane = paneRefsMap.value.get(targetTab.id);

	if (targetPane?.selectFirstEntry) {
		targetPane.selectFirstEntry();
	}

	return true;
}

function callActivePaneMethod(
	method: keyof Pick<
		FileBrowserInstance,
		| 'navigateUp'
		| 'navigateDown'
		| 'navigateLeft'
		| 'navigateRight'
		| 'openSelected'
		| 'navigateBack'
	>
): boolean {
	if (dismissalLayerStore.hasLayers) return false;

	const hasRekaDismissableLayers = document.querySelectorAll('[data-dismissable-layer]').length > 0;

	if (hasRekaDismissableLayers) return false;

	const pane = getActivePaneRef();

	if (pane?.[method]) {
		pane[method]?.();
		return true;
	}

	return false;
}

function registerShortcutHandlers() {
	shortcutsStore.registerHandler('toggleFilter', handleFilterShortcut);
	shortcutsStore.registerHandler('copy', handleCopyShortcut);
	shortcutsStore.registerHandler('cut', handleCutShortcut);
	shortcutsStore.registerHandler('paste', handlePasteShortcut);
	shortcutsStore.registerHandler('selectAll', handleSelectAllShortcut);
	shortcutsStore.registerHandler('delete', handleDeleteShortcut);
	shortcutsStore.registerHandler('deletePermanently', handleDeletePermanentlyShortcut);
	shortcutsStore.registerHandler(
		'rename',
		() => {
			const pane = getActivePaneRef();

			if (pane && selectedEntries.value.length > 0) {
				pane.startRename(selectedEntries.value[0]);
			}
		},
		{ checkItemSelected: hasSelectedItems }
	);
	shortcutsStore.registerHandler('escape', handleEscapeKey);
	shortcutsStore.registerHandler('quickView', handleQuickViewShortcut, {
		checkItemSelected: hasSelectedItems,
	});
	shortcutsStore.registerHandler('openNewTab', handleOpenNewTabShortcut);
	shortcutsStore.registerHandler('openTerminal', handleOpenTerminalShortcut);
	shortcutsStore.registerHandler('openTerminalAdmin', handleOpenTerminalAdminShortcut);
	shortcutsStore.registerHandler('navigateUp', () => callActivePaneMethod('navigateUp'));
	shortcutsStore.registerHandler('navigateDown', () => callActivePaneMethod('navigateDown'));
	shortcutsStore.registerHandler('navigateLeft', () => callActivePaneMethod('navigateLeft'));
	shortcutsStore.registerHandler('navigateRight', () => callActivePaneMethod('navigateRight'));
	shortcutsStore.registerHandler('openSelected', () => callActivePaneMethod('openSelected'), {
		checkItemSelected: hasSelectedItems,
	});
	shortcutsStore.registerHandler('navigateBack', () => callActivePaneMethod('navigateBack'));
	shortcutsStore.registerHandler('switchToLeftPane', () => switchToPane(0));
	shortcutsStore.registerHandler('switchToRightPane', () => switchToPane(1));
}

onMounted(() => {
	registerShortcutHandlers();
	smallScreenMediaQuery.addEventListener('change', handleSmallScreenChange);

	// Recover any in-progress directory size calculations from backend
	dirSizesStore.recoverActiveCalculations();
});

onUnmounted(() => {
	smallScreenMediaQuery.removeEventListener('change', handleSmallScreenChange);
});
</script>

<template>
	
  <div class="h-[calc(100vh-54px)] w-full flex flex-col pr-1">
		<div class="navigator-page__panes-wrapper">
			<div class="navigator-page__panes-container">
				<GlobalSearchView ref="globalSearchViewRef" v-show="globalSearchStore.isOpen"
					class="flex-1" @close="globalSearchStore.close()"
					@open-entry="handleGlobalSearchOpenEntry" @update:selected-entries="handleSearchSelectionChange" />
				<ResizablePanelGroup direction="horizontal" class="navigator-page__panes">
					<template v-if="workspacesStore.currentTabGroup && isSplitView">
						<template v-for="(tab, index) in workspacesStore.currentTabGroup" :key="tab.id">
							<ResizablePanel :default-size="50" :min-size="15" @mousedown="handlePaneFocus(tab.id)">
								<FileBrowserComponent :ref="(el) => setPaneRef(el as FileBrowserInstance, tab.id)" :tab="tab"
									:pane-index="index" :layout="currentLayout" class="navigator-page__pane"
									@update:selected-entries="(entries) => handleSelectionChange(entries, tab.id)"
									@update:current-dir-entry="handleCurrentDirChange" />
							</ResizablePanel>
							<ResizableHandle v-if="index === 0" with-handle />
						</template>
					</template>
					<template v-else-if="workspacesStore.currentTabGroup">
						<ResizablePanel :default-size="100">
							<FileBrowserComponent :key="workspacesStore.currentTabGroup[0].id"
								:ref="(el) => setPaneRef(el as FileBrowserInstance, workspacesStore.currentTabGroup![0].id)"
								:tab="workspacesStore.currentTabGroup[0]" :pane-index="0" :layout="currentLayout"
								class="navigator-page__pane"
								@update:selected-entries="(entries) => handleSelectionChange(entries, workspacesStore.currentTabGroup![0].id)"
								@update:current-dir-entry="handleCurrentDirChange" />
						</ResizablePanel>
					</template>
					<ResizablePanel v-else :default-size="100">
						<FileBrowserComponent ref="singlePaneRef" :layout="currentLayout" class="navigator-page__pane"
							@update:selected-entries="(entries) => handleSelectionChange(entries)"
							@update:current-dir-entry="handleCurrentDirChange" />
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
			<ClipboardToolbarComponent :current-path="currentActivePath" :is-split-view="isSplitView"
				:pane1-path="workspacesStore.currentTabGroup?.[0]?.path"
				:pane2-path="workspacesStore.currentTabGroup?.[1]?.path" @paste="handlePasteShortcut"
				@paste-to-pane="handlePasteToPane" />
		</div>
  </div>
</template>