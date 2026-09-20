<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { WindowFrame } from '@vasakgroup/vue-libvasak';
import { computed, ref } from 'vue';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import NavigatorToolbarActionsComponent from '@/components/navigator/NavigatorToolbarActionsComponent.vue';
import SidebarComponent from '@/components/sidebar/SidebarComponent.vue';
import TabBarComponent from '@/components/tab/TabBarComponent.vue';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { DirEntry } from '@/types/dir-entry';
import ContentInformation from '../components/content/ContentInformation.vue';

const { t } = useI18n();
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
  <!-- La barra cruza la ventana entera. La lateral va **abajo** de ella y no a
       su costado: las pestañas y los botones de ventana son de la ventana, no
       de un panel, y con la barra lateral comiéndose ese ancho esta ventana
       quedaba distinta de todas las demás del escritorio. -->
  <WindowFrame
    :minimize-label="t('window.minimize')"
    :maximize-label="t('window.maximize')"
    :close-label="t('window.close')">
    <template #barra>
      <TabBarComponent teleport-target="" />
    </template>

    <!-- Los botones de la ventana —búsqueda global, dividir, panel de
         información— junto a los de la ventana, que es donde el resto de las
         aplicaciones los pone. -->
    <template #acciones>
      <NavigatorToolbarActionsComponent :is-split-view="isSplitView" :is-global-search-open="globalSearchStore.isOpen"
        :show-info-panel="isInfoPanelVisible" @toggle-split-view="handleToggleSplitView"
        @toggle-global-search="globalSearchStore.toggle()"
        @toggle-info-panel="handleToggleInfoPanel" />
    </template>

    <!-- `p-1` y `gap-1`: la barra lateral es una tarjeta con borde y esquina
         redondeada, y pegada al borde de la ventana se le come el redondeo. Es
         la misma distancia que separa todo lo demás en el escritorio, y es la
         única que se pone: cualquier hueco de más acá adentro hace que esta
         ventana se lea distinta de las otras. -->
    <div class="flex min-h-0 flex-1 gap-1 p-1">
      <SidebarComponent />

      <!-- La columna de contenido. La barra lateral queda **afuera** de ella y
           llega de arriba abajo: la barra de ruta es de lo que se está mirando,
           no de la ventana, así que cruzarla por encima de la lateral la
           acortaba sin motivo. -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
        <!-- La barra de ruta del panel único, subida acá para que cruce el
             contenido entero y no se corra de lugar al plegar la lateral. Con
             la vista dividida cada panel se queda con la suya y este hueco
             desaparece —`empty:hidden`—, que es lo único que deja ver las dos
             rutas a la vez. -->
        <div class="window-path-teleport-target shrink-0 empty:hidden"></div>

        <div class="flex min-h-0 flex-1 gap-1">
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
  </WindowFrame>
</template>
