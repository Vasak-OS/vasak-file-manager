<script lang="ts" setup>
import { computed, ref } from 'vue';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import NavigatorToolbarActionsComponent from '@/components/navigator/NavigatorToolbarActionsComponent.vue';
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
  <div class="h-screen w-screen bg-ui-bg/80 rounded-corner-window flex flex-col border border-ui-border overflow-hidden">
    <!-- La barra superior cruza la ventana entera. La lateral va **abajo** de
         ella y no a su costado: las pestañas y los botones de ventana son de la
         ventana, no de un panel, y con la barra lateral comiéndose ese ancho
         esta ventana quedaba distinta de todas las demás del escritorio. -->
    <TopBarComponent>
      <TabBarComponent teleport-target="" />
      <NavigatorToolbarActionsComponent :is-split-view="isSplitView" :is-global-search-open="globalSearchStore.isOpen"
        :show-info-panel="isInfoPanelVisible" @toggle-split-view="handleToggleSplitView"
        @toggle-info-panel="handleToggleInfoPanel" />
    </TopBarComponent>

    <!-- La barra de ruta del panel único, subida acá para que cruce la ventana
         entera y no se corra de lugar al plegar la lateral. Con la vista
         dividida cada panel se queda con la suya y este hueco desaparece
         —`empty:hidden`—, que es lo único que deja ver las dos rutas a la vez. -->
    <div class="window-path-teleport-target shrink-0 empty:hidden"></div>

    <!-- `p-1` y `gap-1`: la barra lateral es una tarjeta con borde y esquina
         redondeada, y pegada al borde de la ventana se le come el redondeo. -->
    <div class="flex min-h-0 flex-1 gap-1 p-1">
      <SidebarComponent />
      <div class="flex min-h-0 min-w-0 flex-1 gap-1">
        <div class="min-w-0 flex-1">
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
