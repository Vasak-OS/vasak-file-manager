<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ThemeIcon, Tooltip, TooltipContent, TooltipTrigger } from '@vasakgroup/vue-libvasak';
import { computed, ref } from 'vue';
import StatusCenterButton from '@/components/statuscenter/StatusCenterButton.vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import PopoverTrigger from '@/components/ui/popover/PopoverTrigger.vue';
import { useUserLayoutStore } from '@/stores/storage/user-layout';
import type { Layout } from '@/types/navigator';

type LayoutType = Layout;

const { t } = useI18n();
const userLayoutStore = useUserLayoutStore();

const props = defineProps<{
	isSplitView: boolean;
	showInfoPanel: boolean;
	isGlobalSearchOpen: boolean;
}>();

const emit = defineEmits<{
	'toggle-split-view': [];
	'toggle-info-panel': [];
	/**
	 * Abrir o cerrar la búsqueda global.
	 *
	 * Este componente ya recibía `isGlobalSearchOpen` —lo usa para apagar el
	 * botón de dividir, que no tiene sentido con la búsqueda abierta—, pero no
	 * había forma de abrirla: nadie llamaba a `toggle()` ni a `open()` desde
	 * ninguna parte de la interfaz, y tampoco había atajo. La vista se montaba
	 * con `v-show` y no se mostraba nunca.
	 */
	'toggle-global-search': [];
}>();

const isLayoutPopoverOpen = ref(false);
const currentLayout = computed(() => {
	return userLayoutStore.layout;
});
async function setLayout(layoutName: LayoutType) {
	await userLayoutStore.setLayout(layoutName);
	isLayoutPopoverOpen.value = false;
}
</script>

<template>
  <div class="flex items-center gap-1 animate-fade-in">
      <Popover :open="isLayoutPopoverOpen" @update:open="isLayoutPopoverOpen = $event">
        <PopoverTrigger as-child>
          <Tooltip>
            <TooltipTrigger>
              <button class="bg-ui-bg/80 rounded-corner p-1 flex justify-center items-center hover:bg-primary border border-ui-border">
                <ThemeIcon v-if="currentLayout === 'grid'" name="view-grid" type="symbol" :size="24" :alt="t('gridLayout')" />
                <ThemeIcon v-else name="view-list-text" type="symbol" :size="24" :alt="t('listLayout')" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('settings.navigator.navigatorViewLayout') }}</TooltipContent>
          </Tooltip>
        </PopoverTrigger>
        <PopoverContent :side="'bottom'" :align="'end'" class="navigator-layout-popover">
          <button class="flex items-center gap-2 px-2 w-full py-1 rounded-corner hover:bg-primary"
            :class="{ 'bg-secondary hover:bg-primary': currentLayout === 'list' }" @click="setLayout('list')">
            <ThemeIcon name="view-list-text" type="symbol" :size="24" :alt="t('listLayout')" />
            <span>{{ t('listLayout') }}</span>
          </button>
          <button class="flex items-center gap-2 px-2 py-1 rounded-corner hover:bg-primary"
            :class="{ 'bg-secondary hover:bg-primary': currentLayout === 'grid' }" @click="setLayout('grid')">
            <ThemeIcon name="view-grid" type="symbol" :size="24" :alt="t('gridLayout')" />
            <span>{{ t('gridLayout') }}</span>
          </button>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger>
          <button
            class="bg-ui-bg/80 rounded-corner p-1 flex justify-center items-center hover:bg-primary border border-ui-border"
            :class="{ 'bg-primary hover:bg-secondary': props.isGlobalSearchOpen }"
            @click="emit('toggle-global-search')" :aria-label="t('globalSearch.globalSearch')">
            <!-- `search` y no `system-search`: ése es el de la búsqueda rápida
                 de cada panel, que es otra cosa. Éste es el mismo que la propia
                 vista de búsqueda global dibuja en su campo. -->
            <ThemeIcon name="search" type="symbol" :size="24" :alt="t('globalSearch.globalSearch')" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('globalSearch.globalSearch') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <button
            class="bg-ui-bg/80 rounded-corner p-1 flex justify-center items-center hover:bg-primary border border-ui-border"
            :class="{ 'bg-primary hover:bg-secondary': props.isSplitView }"
            :disabled="props.isGlobalSearchOpen"
            @click="emit('toggle-split-view')" :aria-label="t('splitView')">
            <ThemeIcon name="view-split-left-right" type="symbol" :size="24" :alt="t('splitView')" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('splitView') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <button
            class="bg-ui-bg/80 rounded-corner p-1 flex justify-center items-center hover:bg-primary border border-ui-border"
            :class="{ 'bg-primary hover:bg-secondary': props.showInfoPanel }"
            @click="emit('toggle-info-panel')" :aria-label="t('toolbar.infoPanel')">
            <ThemeIcon name="swap-panels" type="symbol" :size="24" :alt="t('toolbar.infoPanel')" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.infoPanel.title') }}</TooltipContent>
      </Tooltip>
      <StatusCenterButton />
    </div>
</template>
