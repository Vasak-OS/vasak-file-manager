<script lang="ts" setup>
import { computed, ref } from 'vue';
import BookmarkPanel from '@/components/bookmark/BookmarkPanel.vue';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import NavigatorToolbarActionsComponent from '@/components/navigator/NavigatorToolbarActionsComponent.vue';
import QuickLookModal from '@/components/preview/QuickLookModal.vue';
import SidebarComponent from '@/components/sidebar/SidebarComponent.vue';
import TabBarComponent from '@/components/tab/TabBarComponent.vue';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { DirEntry } from '@/types/dir-entry';
import ContentInformation from '../components/content/ContentInformation.vue';
import TopBarComponent from '../components/topbar/TopBarComponent.vue';

const workspacesStore = useWorkspacesStore();
const globalSearchStore = useGlobalSearchStore();

const selectedEntries = ref<DirEntry[]>([]);
const currentDirEntry = ref<DirEntry | null>(null);
const isInfoPanelVisible = ref(true);
const isBookmarkPanelVisible = ref(false);
const isQuickLookOpen = ref(false);

/** Quick Look previews the first selected file entry (not directories) */
const quickLookEntry = computed<DirEntry | null>(() => {
	if (selectedEntries.value.length === 0) return null;
	// Show preview for the first selected entry (file or dir)
	return selectedEntries.value[0] ?? null;
});

const isSplitView = computed(() => {
	return (workspacesStore.currentTabGroup?.length ?? 0) > 1;
});

function handleToggleSplitView() {
	if (globalSearchStore.isOpen) return;
	workspacesStore.toggleSplitView();
}

function handleSelectedEntriesUpdate(entries: DirEntry[]) {
	selectedEntries.value = entries;
}

function handleCurrentDirEntryUpdate(entry: DirEntry | null) {
	currentDirEntry.value = entry;
}

function handleToggleInfoPanel() {
	isInfoPanelVisible.value = !isInfoPanelVisible.value;
}

function handleToggleBookmarks() {
	isBookmarkPanelVisible.value = !isBookmarkPanelVisible.value;
}

async function handleBookmarkNavigate(path: string) {
	await workspacesStore.navigateCurrentTab(path);
}
</script>
<template>
  <div class="h-screen w-screen bg-ui-bg/80 rounded-corner-window flex border border-ui-border overflow-hidden">
    <SidebarComponent @toggle-bookmarks="handleToggleBookmarks" />
    <div
      v-if="isBookmarkPanelVisible"
      class="w-56 h-full border-r border-ui-border bg-ui-bg/90 flex-shrink-0"
    >
      <BookmarkPanel @navigate="handleBookmarkNavigate" />
    </div>
    <div class="flex-1 flex flex-col">
      <TopBarComponent>
        <TabBarComponent teleport-target="" />
        <NavigatorToolbarActionsComponent :is-split-view="isSplitView" :is-global-search-open="globalSearchStore.isOpen"
          :show-info-panel="isInfoPanelVisible" @toggle-split-view="handleToggleSplitView"
          @toggle-info-panel="handleToggleInfoPanel" />
      </TopBarComponent>
      <div class="flex-1 flex p-1">
        <div class="flex-1">
          <NavigatorBarComponent 
            @update:selected-entries="handleSelectedEntriesUpdate"
            @update:current-dir-entry="handleCurrentDirEntryUpdate" />
        </div>
        <ContentInformation v-if="isInfoPanelVisible"
          :selected-entries="selectedEntries"
          :current-dir-entry="currentDirEntry" />
      </div>
    </div>
  </div>
  <!-- Quick Look overlay (Req 12.6, 12.8, 12.9) -->
  <QuickLookModal v-model:open="isQuickLookOpen" :entry="quickLookEntry" />
</template>
