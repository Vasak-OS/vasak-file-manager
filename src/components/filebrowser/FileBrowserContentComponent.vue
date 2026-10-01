<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	Checkbox,
	EmptyState,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Skeleton,
	ThemeIcon,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@vasakgroup/vue-libvasak';
import { computed, ref } from 'vue';
import FileBrowserError from '@/components/filebrowser/FileBrowserErrorComponent.vue';
import FileBrowserLoading from '@/components/filebrowser/FileBrowserLoadingComponent.vue';
import { useFileBrowserContext } from '@/composables/file-browser/use-file-browser-context';
import type { Layout } from '@/types/navigator';
import type { ListSortColumn } from '@/types/short';
import FileBrowserGridView from '@/views/filebrowser/FileBrowserGridView.vue';
import FileBrowserListView from '@/views/filebrowser/FileBrowserListView.vue';

const props = defineProps<{
	layout?: Layout;
}>();
const { t } = useI18n();

const ctx = useFileBrowserContext();
const legendSizeText = '1.5 GB';
const isColumnsPopoverOpen = ref(false);

const columnVisibility = ref({
	items: true,
	size: true,
	modified: true,
});
const showItemsColumn = computed(() => columnVisibility.value.items);

/**
 * Las columnas de la lista. Las secundarias van de cero a su ancho, y no de un
 * mínimo fijo: en un panel angosto (una ventana de 240 píxeles, o cada mitad de
 * la vista dividida) la suma de los mínimos no entraba y la fecha y el tamaño
 * quedaban cortados por el borde. Ahora se achican y su texto termina en «…»;
 * con lugar, cada una llega a su ancho de siempre.
 */
const listColumnsTemplate = computed(() => {
	const columns = ['minmax(80px, 1fr)'];

	if (showItemsColumn.value) {
		columns.push('minmax(0, 90px)');
	}

	if (columnVisibility.value.size) {
		columns.push('minmax(0, 100px)');
	}

	if (columnVisibility.value.modified) {
		columns.push('minmax(0, 160px)');
	}

	return columns.join(' ');
});

function toggleColumnVisibility(column: 'items' | 'size' | 'modified', checked: boolean) {
	columnVisibility.value[column] = checked;
}

const listSortColumn = ref<ListSortColumn | null>('name');
const listSortDirection = ref<'asc' | 'desc'>('asc');

function handleColumnHeaderClick(column: ListSortColumn) {
	if (listSortColumn.value === column) {
		listSortDirection.value = listSortDirection.value === 'asc' ? 'desc' : 'asc';
	} else {
		listSortColumn.value = column;
		listSortDirection.value = 'asc';
	}
}

const sortedEntries = computed(() => {
	const entries = [...ctx.entries.value];

	if (!listSortColumn.value) return entries;

	entries.sort((a, b) => {
		let aValue: any;
		let bValue: any;

		switch (listSortColumn.value) {
			case 'name':
				aValue = a.name.toLowerCase();
				bValue = b.name.toLowerCase();
				break;
			case 'size':
				aValue = a.is_dir ? (a.item_count ?? 0) : a.size;
				bValue = b.is_dir ? (b.item_count ?? 0) : b.size;
				break;
			case 'items':
				aValue = a.item_count ?? 0;
				bValue = b.item_count ?? 0;
				break;
			case 'modified':
				aValue = a.modified_time;
				bValue = b.modified_time;
				break;
			default:
				return 0;
		}

		// Handle string comparisons
		if (typeof aValue === 'string' && typeof bValue === 'string') {
			return listSortDirection.value === 'asc'
				? aValue.localeCompare(bValue)
				: bValue.localeCompare(aValue);
		}

		// Handle numeric comparisons
		if (listSortDirection.value === 'asc') {
			return aValue - bValue;
		} else {
			return bValue - aValue;
		}
	});

	return entries;
});
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden [--file-browser-list-row-padding-y:10px] [--file-browser-list-row-padding-x:16px] [--file-browser-list-header-padding-x:16px] [--file-browser-list-header-padding-y:10px] [--file-browser-list-cell-padding-right:16px] [--file-browser-list-right-gutter:24px]" :style="{ '--file-browser-list-columns': listColumnsTemplate }">
    <div v-if="props.layout === 'list'" class="relative pr-[var(--file-browser-list-right-gutter)] border-b border-ui-line">
      <div class="grid py-[var(--file-browser-list-header-padding-y)] px-[var(--file-browser-list-header-padding-x)] text-tx-muted text-label-xs font-medium [grid-template-columns:var(--file-browser-list-columns)] uppercase">
        <button type="button"
          class="flex min-w-0 items-center overflow-hidden whitespace-nowrap pr-[var(--file-browser-list-cell-padding-right)] gap-2 border-none bg-transparent text-inherit cursor-pointer uppercase hover:text-tx-main"
          @click="handleColumnHeaderClick('name')">
          {{ t('fileBrowser.name') }}
          <ThemeIcon
            v-if="listSortColumn === 'name' && listSortDirection === 'asc'"
            name="arrow-up"
            type="symbol"
            :size="16"
            :alt="t('fileBrowser.sortAscending')" />
          <ThemeIcon
            v-else-if="listSortColumn === 'name' && listSortDirection === 'desc'"
            name="arrow-down"
            type="symbol"
            :size="16"
            :alt="t('fileBrowser.sortDescending')" />
        </button>
        <button v-if="showItemsColumn" type="button"
          class="flex min-w-0 items-center overflow-hidden whitespace-nowrap pr-[var(--file-browser-list-cell-padding-right)] gap-2 border-none bg-transparent text-inherit cursor-pointer uppercase hover:text-tx-main"
          @click="handleColumnHeaderClick('items')">
          {{ t('fileBrowser.items') }}
          <ThemeIcon
            v-if="listSortColumn === 'items' && listSortDirection === 'asc'"
            name="arrow-up"
            type="symbol"
            :size="16"
            :alt="t('fileBrowser.sortAscending')" />
          <ThemeIcon
            v-else-if="listSortColumn === 'items' && listSortDirection === 'desc'"
            name="arrow-down"
            type="symbol"
            :size="16"
            :alt="t('fileBrowser.sortDescending')" />
        </button>
        <Tooltip v-if="columnVisibility.size" :delay-duration="200">
          <TooltipTrigger>
            <button type="button"
              class="flex min-w-0 items-center overflow-hidden whitespace-nowrap pr-[var(--file-browser-list-cell-padding-right)] gap-2 border-none bg-transparent text-inherit cursor-pointer uppercase hover:text-tx-main"
              @click="handleColumnHeaderClick('size')">
              {{ t('fileBrowser.size') }}
              <ThemeIcon name="showinfo" type="symbol" :size="16" alt="" />
              <ThemeIcon
                v-if="listSortColumn === 'size' && listSortDirection === 'asc'"
                name="arrow-up"
                type="symbol"
                :size="16"
                :alt="t('fileBrowser.sortAscending')" />
              <ThemeIcon
                v-else-if="listSortColumn === 'size' && listSortDirection === 'desc'"
                name="arrow-down"
                type="symbol"
                :size="16"
                :alt="t('fileBrowser.sortDescending')" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" :side-offset="8" class="max-w-[300px]">
            <div class="flex max-w-[300px] flex-col gap-2.5">
              <div class="text-tx-main text-xs font-semibold tracking-[0.02em] uppercase">
                {{ t('fileBrowser.sizeTooltip.title') }}
              </div>
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-2.5">
                  <span class="inline-flex w-[70px] shrink-0 items-center justify-center py-0.5 px-2 rounded-corner-xs bg-ui-selected-accent text-primary font-mono text-label-xs font-medium">{{ legendSizeText }}</span>
                  <span class="text-tx-muted text-xs leading-[1.4]">{{ t('fileBrowser.sizeTooltip.exact') }}</span>
                </div>
                <div class="flex items-center gap-2.5">
                  <span
                    class="inline-flex w-[70px] shrink-0 items-center justify-center py-0.5 px-2 rounded-corner-xs font-mono text-label-xs font-medium bg-transparent">
                    <Skeleton width="100%" :height="12" />
                  </span>
                  <span class="text-tx-muted text-xs leading-[1.4]">{{ t('fileBrowser.sizeTooltip.loading') }}</span>
                </div>
                <div class="flex items-center gap-2.5">
                  <span
                    class="inline-flex w-[70px] shrink-0 items-center justify-center py-0.5 px-2 rounded-corner-xs font-mono text-label-xs font-medium bg-ui-surface/30 text-tx-muted">—</span>
                  <span class="text-tx-muted text-xs leading-[1.4]">{{ t('fileBrowser.sizeTooltip.notCalculated') }}</span>
                </div>
              </div>
              <div class="pt-1.5 border-t border-ui-line-weak text-tx-muted text-label-xs italic leading-[1.4]">
                {{ t('fileBrowser.sizeTooltip.note') }}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
        <button v-if="columnVisibility.modified" type="button"
          class="flex min-w-0 items-center overflow-hidden whitespace-nowrap pr-[var(--file-browser-list-cell-padding-right)] gap-2 border-none bg-transparent text-inherit cursor-pointer uppercase hover:text-tx-main"
          @click="handleColumnHeaderClick('modified')">
          {{ t('fileBrowser.modified') }}
          <ThemeIcon
            v-if="listSortColumn === 'modified' && listSortDirection === 'asc'"
            name="arrow-up"
            type="symbol"
            :size="16"
            :alt="t('fileBrowser.sortAscending')" />
          <ThemeIcon
            v-else-if="listSortColumn === 'modified' && listSortDirection === 'desc'"
            name="arrow-down"
            type="symbol"
            :size="16"
            :alt="t('fileBrowser.sortDescending')" />
        </button>
      </div>
      <Popover :open="isColumnsPopoverOpen" @update:open="isColumnsPopoverOpen = $event">
        <Tooltip>
          <TooltipTrigger class="absolute top-1/2 right-0 -translate-y-1/2">
            <PopoverTrigger as-child>
              <ActionButton label="" :icon-alt="t('fileBrowser.columns')" icon="view-file-columns" variant="ghost"
                size="sm" />
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {{ t('fileBrowser.columns') }}
          </TooltipContent>
        </Tooltip>
        <PopoverContent side="bottom" align="end" padding="sm" class="flex flex-col gap-2 capitalize"
          :label="t('fileBrowser.columns')">
          <Checkbox :model-value="columnVisibility.items" :label="t('fileBrowser.items')"
            @update:model-value="toggleColumnVisibility('items', $event)" />
          <Checkbox :model-value="columnVisibility.size" :label="t('fileBrowser.size')"
            @update:model-value="toggleColumnVisibility('size', $event)" />
          <Checkbox :model-value="columnVisibility.modified" :label="t('fileBrowser.modified')"
            @update:model-value="toggleColumnVisibility('modified', $event)" />
        </PopoverContent>
      </Popover>
    </div>

    <FileBrowserLoading v-if="ctx.isLoading.value" />

    <FileBrowserError v-else-if="ctx.error.value" :error="ctx.error.value" @go-home="ctx.navigateToHome" />

    <EmptyState v-else-if="ctx.isDirectoryEmpty.value" class="flex flex-1 items-center justify-center p-4"
      icon="folder-open" :title="t('fileBrowser.directoryIsEmpty')"
      :note="t('fileBrowser.directoryIsEmptyDescription')" />

    <template v-else>
      <!-- El que desplaza: los desplazadores virtuales de las dos vistas van en
           modo página y lo buscan a él. Era el `ScrollArea` propio, que dibujaba
           una barra con `bg-ui-bg/80` (invisible sobre la ventana); la barra
           ahora es la de `scrollbar.css` y la estructura de dos cajas es la
           misma. -->
      <div class="relative min-h-0 w-full flex-1 overflow-hidden">
        <div class="h-full w-full overflow-x-hidden overflow-y-auto">
          <div :ref="ctx.setEntriesContainerRef" class="min-h-full">
            <FileBrowserGridView v-if="props.layout === 'grid'" :entries="sortedEntries" />
            <FileBrowserListView v-else :entries="sortedEntries" />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
