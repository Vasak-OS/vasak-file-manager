<script lang="ts" setup>
import { computed, ref } from 'vue';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import SidebarComponent from '@/components/sidebar/SidebarComponent.vue';
import ContentInformation from '../components/content/ContentInformation.vue';
import TopBarComponent from '../components/topbar/TopBarComponent.vue';
import TabBarComponent from '@/components/tab/TabBarComponent.vue';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import NavigatorToolbarActionsComponent from '@/components/navigator/NavigatorToolbarActionsComponent.vue';
import type { DirEntry } from '@/types/dir-entry';

const workspacesStore = useWorkspacesStore();
const globalSearchStore = useGlobalSearchStore();

const selectedEntries = ref<DirEntry[]>([]);
const currentDirEntry = ref<DirEntry | null>(null);
const isInfoPanelVisible = ref(true);

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
</script>
<template>
  <div class="h-screen w-screen background rounded-corner-window flex">
    <SidebarComponent />
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
</template>
