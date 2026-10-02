<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Kbd,
	Popover,
	PopoverContent,
	PopoverTrigger,
	SearchField,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@vasakgroup/vue-libvasak';
import { ref } from 'vue';
import AddressBarComponent from '@/components/AddressBarComponent.vue';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';

const props = defineProps<{
	/**
	 * Si la barra está sola en la ventana en vez de arriba de un panel.
	 *
	 * Suelta es una tarjeta con borde entero y fondo de superficie, como los
	 * demás paneles del escritorio. Arriba de un panel alcanza con la línea de
	 * abajo: el borde y el fondo ya se los pone el panel, y repetirlos dibuja
	 * un marco adentro de otro.
	 */
	standalone?: boolean;
	pathInput: string;
	filterQuery: string;
	canGoBack: boolean;
	canGoForward: boolean;
	canGoUp: boolean;
	isLoading: boolean;
	isFilterOpen: boolean;
}>();

const emit = defineEmits<{
	(event: 'update:pathInput', value: string): void;
	(event: 'update:filterQuery', value: string): void;
	(event: 'update:isFilterOpen', value: boolean): void;
	(event: 'goBack'): void;
	(event: 'goForward'): void;
	(event: 'goUp'): void;
	(event: 'goHome'): void;
	(event: 'refresh'): void;
	(event: 'submitPath'): void;
	(event: 'navigateTo', path: string): void;
	(event: 'createNewDirectory'): void;
	(event: 'createNewFile'): void;
}>();

const shortcutsStore = useShortcutsStore();
const { t } = useI18n();

const isCreateMenuOpen = ref(false);

function handleFilterQueryUpdate(value: string | number | undefined) {
	emit('update:filterQuery', String(value ?? ''));
}

function handleAddressBarNavigate(path: string) {
	emit('update:pathInput', path);
	emit('navigateTo', path);
}

function handleCreateMenuOpenChange(value: boolean) {
	isCreateMenuOpen.value = value;
}
</script>

<template>
  <div
    class="@container flex h-12 min-w-0 items-center gap-2 p-2"
    :class="props.standalone
      ? 'rounded-corner-l border border-ui-line bg-ui-surface/70'
      : 'border-b border-ui-line'">
    <!-- Con lugar, los cinco botones de recorrido. Angosta, atrás queda a la
         vista y los otros cuatro van a un menú: antes, por debajo de 400
         píxeles, desaparecían los cinco y sólo quedaban los atajos. -->
    <div class="hidden shrink-0 gap-1 @[400px]:flex">
      <Tooltip>
        <TooltipTrigger>
          <ActionButton label="" :icon-alt="t('fileBrowser.goBack')" icon="go-previous" variant="ghost"
            :disabled="!canGoBack" @click="emit('goBack')" />
        </TooltipTrigger>
        <TooltipContent>{{ t('fileBrowser.goBack') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <ActionButton label="" :icon-alt="t('fileBrowser.goForward')" icon="go-next" variant="ghost"
            :disabled="!canGoForward" @click="emit('goForward')" />
        </TooltipTrigger>
        <TooltipContent>{{ t('fileBrowser.goForward') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <ActionButton label="" :icon-alt="t('fileBrowser.goUp')" icon="go-up" variant="ghost"
            :disabled="!canGoUp" @click="emit('goUp')" />
        </TooltipTrigger>
        <TooltipContent>{{ t('fileBrowser.goUp') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <ActionButton label="" :icon-alt="t('fileBrowser.goHome')" icon="go-home" variant="ghost"
            @click="emit('goHome')" />
        </TooltipTrigger>
        <TooltipContent>{{ t('fileBrowser.goHome') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <!-- `view-refresh`, el nombre de freedesktop; `refreshstructure` no
               lo es y dependía de que el tema lo trajera. -->
          <ActionButton label="" :icon-alt="t('fileBrowser.refresh')" icon="view-refresh" variant="ghost"
            :loading="isLoading" @click="emit('refresh')" />
        </TooltipTrigger>
        <TooltipContent>{{ t('fileBrowser.refresh') }}</TooltipContent>
      </Tooltip>
    </div>
    <div class="flex shrink-0 gap-1 @[400px]:hidden">
      <ActionButton label="" :icon-alt="t('fileBrowser.goBack')" :title="t('fileBrowser.goBack')" icon="go-previous"
        variant="ghost" :disabled="!canGoBack" @click="emit('goBack')" />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <ActionButton label="" :icon-alt="t('fileBrowser.navigation')" :title="t('fileBrowser.navigation')"
            icon="view-more" variant="ghost" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" class="min-w-45">
          <DropdownMenuItem icon="go-next" :disabled="!canGoForward" @click="emit('goForward')">
            {{ t('fileBrowser.goForward') }}
          </DropdownMenuItem>
          <DropdownMenuItem icon="go-up" :disabled="!canGoUp" @click="emit('goUp')">
            {{ t('fileBrowser.goUp') }}
          </DropdownMenuItem>
          <DropdownMenuItem icon="go-home" @click="emit('goHome')">
            {{ t('fileBrowser.goHome') }}
          </DropdownMenuItem>
          <DropdownMenuItem icon="view-refresh" :disabled="isLoading" @click="emit('refresh')">
            {{ t('fileBrowser.refresh') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div class="flex min-w-0 flex-1 items-center gap-1">
      <AddressBarComponent :current-path="pathInput" class="min-w-0 flex-1"
        @navigate="handleAddressBarNavigate" />
      <DropdownMenu :open="isCreateMenuOpen" @update:open="handleCreateMenuOpenChange">
        <Tooltip>
          <!-- El disparador va **pegado** al botón y no envolviendo al del
               tooltip: `as-child` le pone encima `aria-haspopup` y
               `aria-expanded`, y eso tiene que quedar en lo que recibe el foco.
               Apagado porque quien abre y cierra es el botón: con los dos
               manejadores en el mismo elemento, su `stopPropagation` no frena
               al del disparador y el menú se abriría y cerraría de un clic. -->
          <TooltipTrigger>
            <DropdownMenuTrigger as-child :disabled="true">
              <ActionButton label="" :icon-alt="t('fileBrowser.createNew')" icon="list-add" variant="ghost"
                stop-propagation prevent-default @click="isCreateMenuOpen = !isCreateMenuOpen" />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{{ t('fileBrowser.newDirectoryFile') }}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" side="bottom" class="min-w-30">
          <DropdownMenuItem icon="folder-new" @click="emit('createNewDirectory')">
            {{ t('fileBrowser.newDirectory') }}
          </DropdownMenuItem>
          <DropdownMenuItem icon="document-new" @click="emit('createNewFile')">
            {{ t('fileBrowser.newFile') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover :open="isFilterOpen" @update:open="emit('update:isFilterOpen', $event)">
        <Tooltip>
          <TooltipTrigger>
            <PopoverTrigger as-child>
              <ActionButton label="" :icon-alt="t('fileBrowser.filter')" icon="system-search" variant="ghost"
                :pressed="Boolean(filterQuery)" />
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {{ t('fileBrowser.quickSearch') }}
            <Kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('toggleFilter') }}</Kbd>
          </TooltipContent>
        </Tooltip>
        <PopoverContent side="bottom" align="end" padding="sm" class="w-70" :label="t('fileBrowser.quickSearch')">
          <SearchField
            :model-value="filterQuery"
            :placeholder="t('fileBrowser.searchThisDirectory')"
            :label="t('fileBrowser.searchThisDirectory')"
            :clear-label="t('fileBrowser.clearFilter')"
            @update:model-value="handleFilterQueryUpdate" />
        </PopoverContent>
      </Popover>
    </div>
  </div>
</template>
