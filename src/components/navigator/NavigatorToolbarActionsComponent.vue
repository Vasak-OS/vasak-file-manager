<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Popover,
	PopoverContent,
	PopoverTrigger,
	SegmentedControl,
	type SegmentedOption,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@vasakgroup/vue-libvasak';
import { computed, ref } from 'vue';
import StatusCenterButton from '@/components/statuscenter/StatusCenterButton.vue';
import { useWindowColumns } from '@/composables/use-window-columns';
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
	/** Abrir o cerrar el cajón de la barra lateral, en una ventana compacta. */
	'toggle-sidebar': [];
}>();

/**
 * En una columna por vez los cuatro botones no entran al lado de las pestañas
 * y de los de la ventana: a 240 píxeles se comían los de cerrar y minimizar.
 * Ahí pasan a un menú «más» con los mismos cuatro, marcados igual; el centro
 * de estado queda afuera porque avisa solo cuando hay trabajo. En compacto el
 * menú suma «Lugares», el cajón de la barra lateral.
 */
const { isOneColumn, isCompact, isSidebarOpen } = useWindowColumns();

const isLayoutPopoverOpen = ref(false);
const currentLayout = computed(() => {
	return userLayoutStore.layout;
});
async function setLayout(layoutName: LayoutType) {
	await userLayoutStore.setLayout(layoutName);
	isLayoutPopoverOpen.value = false;
}

const layoutOptions = computed<SegmentedOption<LayoutType>[]>(() => [
	{ value: 'list', label: t('listLayout'), icon: 'view-list-text' },
	{ value: 'grid', label: t('gridLayout'), icon: 'view-grid' },
]);
</script>

<template>
  <div class="flex min-w-0 items-center gap-1">
    <template v-if="!isOneColumn">
      <Popover :open="isLayoutPopoverOpen" @update:open="isLayoutPopoverOpen = $event">
        <Tooltip>
          <TooltipTrigger>
            <PopoverTrigger as-child>
              <ActionButton
                label=""
                :icon-alt="currentLayout === 'grid' ? t('gridLayout') : t('listLayout')"
                :icon="currentLayout === 'grid' ? 'view-grid' : 'view-list-text'"
                variant="ghost" />
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{{ t('settings.navigator.navigatorViewLayout') }}</TooltipContent>
        </Tooltip>
        <PopoverContent side="bottom" align="end" padding="sm" :label="t('settings.navigator.navigatorViewLayout')">
          <SegmentedControl
            :model-value="currentLayout"
            :options="layoutOptions"
            :label="t('settings.navigator.navigatorViewLayout')"
            @update:model-value="setLayout($event as LayoutType)" />
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger>
          <!-- `search` y no `system-search`: ése es el de la búsqueda rápida
               de cada panel, que es otra cosa. Éste es el mismo que la propia
               vista de búsqueda global dibuja en su campo. -->
          <ActionButton
            label=""
            :icon-alt="t('globalSearch.globalSearch')"
            icon="search"
            variant="ghost"
            :pressed="props.isGlobalSearchOpen"
            @click="emit('toggle-global-search')" />
        </TooltipTrigger>
        <TooltipContent>{{ t('globalSearch.globalSearch') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <ActionButton
            label=""
            :icon-alt="t('splitView')"
            icon="view-split-left-right"
            variant="ghost"
            :pressed="props.isSplitView"
            :disabled="props.isGlobalSearchOpen"
            @click="emit('toggle-split-view')" />
        </TooltipTrigger>
        <TooltipContent>{{ t('splitView') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <ActionButton
            label=""
            :icon-alt="t('toolbar.infoPanel')"
            icon="swap-panels"
            variant="ghost"
            :pressed="props.showInfoPanel"
            @click="emit('toggle-info-panel')" />
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.infoPanel.title') }}</TooltipContent>
      </Tooltip>
    </template>

    <DropdownMenu v-else>
      <DropdownMenuTrigger as-child>
        <ActionButton
          label=""
          :icon-alt="t('window.moreActions')"
          :title="t('window.moreActions')"
          icon="view-more"
          variant="ghost" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" class="min-w-50">
        <!-- En compacto, la barra lateral se abre desde acá: un botón suelto
             le quitaba el lugar a las pestañas. -->
        <template v-if="isCompact">
          <DropdownMenuItem icon="sidebar-show" toggle="checkbox" :checked="isSidebarOpen" @click="emit('toggle-sidebar')">
            {{ t('window.places') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </template>
        <DropdownMenuItem icon="view-list-text" toggle="radio" :checked="currentLayout === 'list'" @click="setLayout('list')">
          {{ t('listLayout') }}
        </DropdownMenuItem>
        <DropdownMenuItem icon="view-grid" toggle="radio" :checked="currentLayout === 'grid'" @click="setLayout('grid')">
          {{ t('gridLayout') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon="search" toggle="checkbox" :checked="props.isGlobalSearchOpen" @click="emit('toggle-global-search')">
          {{ t('globalSearch.globalSearch') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon="view-split-left-right"
          toggle="checkbox"
          :checked="props.isSplitView"
          :disabled="props.isGlobalSearchOpen"
          @click="emit('toggle-split-view')">
          {{ t('splitView') }}
        </DropdownMenuItem>
        <DropdownMenuItem icon="swap-panels" toggle="checkbox" :checked="props.showInfoPanel" @click="emit('toggle-info-panel')">
          {{ t('settings.infoPanel.title') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <!-- En compacto, el centro de estado aparece sólo cuando hay trabajo. -->
    <StatusCenterButton :hide-when-idle="isCompact" />
  </div>
</template>
