<script setup lang="ts">
import { getIconSource, getSymbolSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, onMounted, ref } from 'vue';
import FileBrowserContextMenu from '@/components/filebrowser/FileBrowserContextMenuComponent.vue';
import FileBrowserError from '@/components/filebrowser/FileBrowserErrorComponent.vue';
import FileBrowserLoading from '@/components/filebrowser/FileBrowserLoadingComponent.vue';
import ContextMenu from '@/components/ui/contextmenu/ContextMenu.vue';
import ContextMenuTrigger from '@/components/ui/contextmenu/ContextMenuTrigger.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import PopoverTrigger from '@/components/ui/popover/PopoverTrigger.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { useFileBrowserContext } from '@/composables/file-browser/use-file-browser-context';
import type { Layout } from '@/types/navigator';
import type { ListSortColumn } from '@/types/short';
import FileBrowserGridView from '@/views/filebrowser/FileBrowserGridView.vue';
import FileBrowserListView from '@/views/filebrowser/FileBrowserListView.vue';

const props = defineProps<{
	layout?: Layout;
}>();
const { t } = useI18n();
const folderOpenIcon = ref('');

const ctx = useFileBrowserContext();
const legendSizeText = '1.5 GB';
const isColumnsPopoverOpen = ref(false);
const arrowUpIcon = ref('');
const arrowDownIcon = ref('');
const infoIcon = ref('');
const columnsIcon = ref('');

const columnVisibility = ref({
	items: true,
	size: true,
	modified: true,
});
const showItemsColumn = computed(() => columnVisibility.value.items);

const listColumnsTemplate = computed(() => {
	const columns = ['minmax(80px, 1fr)'];

	if (showItemsColumn.value) {
		columns.push('minmax(70px, 90px)');
	}

	if (columnVisibility.value.size) {
		columns.push('minmax(50px, 100px)');
	}

	if (columnVisibility.value.modified) {
		columns.push('minmax(60px, 160px)');
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

onMounted(async () => {
	folderOpenIcon.value = await getIconSource('folder-open');
	arrowUpIcon.value = await getSymbolSource('arrow-up');
	arrowDownIcon.value = await getSymbolSource('arrow-down');
	infoIcon.value = await getSymbolSource('showinfo');
	columnsIcon.value = await getSymbolSource('view-file-columns');
});
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden [--file-browser-list-row-padding-y:10px] [--file-browser-list-row-padding-x:16px] [--file-browser-list-header-padding-x:16px] [--file-browser-list-header-padding-y:10px] [--file-browser-list-cell-padding-right:16px] [--file-browser-list-right-gutter:24px]" :style="{ '--file-browser-list-columns': listColumnsTemplate }">
    <div v-if="props.layout === 'list'" class="relative pr-[var(--file-browser-list-right-gutter)] border-b border-ui-border">
      <div class="grid py-[var(--file-browser-list-header-padding-y)] px-[var(--file-browser-list-header-padding-x)] bg-ui-bg/80-3 text-muted-foreground text-xs font-medium [grid-template-columns:var(--file-browser-list-columns)] uppercase">
        <button type="button"
          class="flex items-center pr-[var(--file-browser-list-cell-padding-right)] gap-2 border-none bg-transparent text-inherit cursor-pointer uppercase hover:text-foreground outline-none"
          @click="handleColumnHeaderClick('name')">
          {{ t('fileBrowser.name') }}
          <img :src="arrowUpIcon" alt="Arrow up" v-if="listSortColumn === 'name' && listSortDirection === 'asc'" 
            class="h-4 w-4" />
          <img :src="arrowDownIcon" alt="Arrow down" v-else-if="listSortColumn === 'name' && listSortDirection === 'desc'" 
            class="h-4 w-4" />
        </button>
        <button v-if="showItemsColumn" type="button"
          class="flex items-center pr-[var(--file-browser-list-cell-padding-right)] gap-2 border-none bg-transparent text-inherit cursor-pointer uppercase hover:text-foreground outline-none"
          @click="handleColumnHeaderClick('items')">
          {{ t('fileBrowser.items') }}
          <img :src="arrowUpIcon" alt="Arrow up" v-if="listSortColumn === 'items' && listSortDirection === 'asc'" 
            class="h-4 w-4" />
          <img :src="arrowDownIcon" alt="Arrow down" v-else-if="listSortColumn === 'items' && listSortDirection === 'desc'"
            class="h-4 w-4" />
        </button>
        <Tooltip v-if="columnVisibility.size" :delay-duration="200">
          <TooltipTrigger as-child>
            <button type="button"
              class="flex items-center pr-[var(--file-browser-list-cell-padding-right)] gap-2 border-none bg-transparent text-inherit cursor-pointer uppercase hover:text-foreground outline-none"
              @click="handleColumnHeaderClick('size')">
              {{ t('fileBrowser.size') }}
              <img :src="infoIcon" alt="Info" />
              <img :src="arrowUpIcon" alt="Arrow up" v-if="listSortColumn === 'size' && listSortDirection === 'asc'" :size="12"
                class="h-4 w-4" />
              <img :src="arrowDownIcon" alt="Arrow down" v-else-if="listSortColumn === 'size' && listSortDirection === 'desc'" :size="12"
                class="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" :side-offset="8" class="max-w-[300px]">
            <div class="flex max-w-[300px] flex-col gap-2.5">
              <div class="text-foreground text-xs font-semibold tracking-[0.02em] uppercase">
                {{ t('fileBrowser.sizeTooltip.title') }}
              </div>
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-2.5">
                  <span class="inline-flex w-[70px] shrink-0 items-center justify-center py-0.5 px-2 rounded bg-primary/15 text-primary font-mono text-[11px] font-medium">{{ legendSizeText }}</span>
                  <span class="text-muted-foreground text-xs leading-[1.4]">{{ t('fileBrowser.sizeTooltip.exact') }}</span>
                </div>
                <div class="flex items-center gap-2.5">
                  <span
                    class="inline-flex w-[70px] shrink-0 items-center justify-center py-0.5 px-2 rounded font-mono text-[11px] font-medium bg-transparent">
                    <Skeleton class="w-full h-3" />
                  </span>
                  <span class="text-muted-foreground text-xs leading-[1.4]">{{ t('fileBrowser.sizeTooltip.loading') }}</span>
                </div>
                <div class="flex items-center gap-2.5">
                  <span
                    class="inline-flex w-[70px] shrink-0 items-center justify-center py-0.5 px-2 rounded font-mono text-[11px] font-medium bg-muted/30 text-muted-foreground">—</span>
                  <span class="text-muted-foreground text-xs leading-[1.4]">{{ t('fileBrowser.sizeTooltip.notCalculated') }}</span>
                </div>
              </div>
              <div class="pt-1.5 border-t border-ui-border/50 text-muted-foreground text-[11px] italic leading-[1.4]">
                {{ t('fileBrowser.sizeTooltip.note') }}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
        <button v-if="columnVisibility.modified" type="button"
          class="flex items-center pr-[var(--file-browser-list-cell-padding-right)] gap-2 border-none bg-transparent text-inherit cursor-pointer uppercase hover:text-foreground outline-none"
          @click="handleColumnHeaderClick('modified')">
          {{ t('fileBrowser.modified') }}
          <img :src="arrowUpIcon" alt="Arrow up" v-if="listSortColumn === 'modified' && listSortDirection === 'asc'" 
            class="h-4 w-4" />
          <img :src="arrowDownIcon" alt="Arrow down" v-else-if="listSortColumn === 'modified' && listSortDirection === 'desc'"
            class="h-4 w-4" />
        </button>
      </div>
      <Popover :open="isColumnsPopoverOpen" @update:open="isColumnsPopoverOpen = $event">
        <Tooltip>
          <TooltipTrigger as-child>
            <PopoverTrigger as-child>
              <button type="button" class="absolute top-1/2 right-0 w-7 h-7 text-muted-foreground -translate-y-1/2 outline-none">
                <img :src="columnsIcon" :alt="t('fileBrowser.columns')" class="h-4 w-4" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <PopoverContent :side="'bottom'" :align="'end'" class="flex w-auto flex-col px-3 py-2 gap-2">
            <div class="flex items-center gap-2 capitalize">
              <input id="column-items" type="checkbox" class="w-3.5 h-3.5 m-0 accent-primary"
                :checked="columnVisibility.items"
                @change="toggleColumnVisibility('items', ($event.target as HTMLInputElement).checked)" />
              <label for="column-items" class="cursor-pointer text-[13px] select-none">{{ t('fileBrowser.items') }}</label>
            </div>
            <div class="flex items-center gap-2 capitalize">
              <input id="column-size" type="checkbox" class="w-3.5 h-3.5 m-0 accent-primary"
                :checked="columnVisibility.size"
                @change="toggleColumnVisibility('size', ($event.target as HTMLInputElement).checked)" />
              <label for="column-size" class="cursor-pointer text-[13px] select-none">{{ t('fileBrowser.size') }}</label>
            </div>
            <div class="flex items-center gap-2 capitalize">
              <input id="column-modified" type="checkbox" class="w-3.5 h-3.5 m-0 accent-primary"
                :checked="columnVisibility.modified"
                @change="toggleColumnVisibility('modified', ($event.target as HTMLInputElement).checked)" />
              <label for="column-modified" class="cursor-pointer text-[13px] select-none">{{ t('fileBrowser.modified') }}</label>
            </div>
          </PopoverContent>
          <TooltipContent>
            {{ t('fileBrowser.columns') }}
          </TooltipContent>
        </Tooltip>
      </Popover>
    </div>

    <FileBrowserLoading v-if="ctx.isLoading.value" />

    <FileBrowserError v-else-if="ctx.error.value" :error="ctx.error.value" @go-home="ctx.navigateToHome" />

    <EmptyState v-else-if="ctx.isDirectoryEmpty.value" class="flex flex-1 items-center justify-center p-4"
      :icon="folderOpenIcon" :title="t('fileBrowser.directoryIsEmpty')"
      :description="t('fileBrowser.directoryIsEmptyDescription')" :bordered="false" />

    <template v-else>
      <ScrollArea class="relative min-h-0 flex-1" @contextmenu.self.prevent>
        <ContextMenu>
          <ContextMenuTrigger as-child>
            <div :ref="ctx.setEntriesContainerRef" class="min-h-full" @contextmenu.self.prevent>
              <FileBrowserGridView v-if="props.layout === 'grid'" :entries="sortedEntries" />
              <FileBrowserListView v-else :entries="sortedEntries" />
            </div>
          </ContextMenuTrigger>
          <FileBrowserContextMenu v-if="ctx.contextMenu.value.selectedEntries.length > 0" />
        </ContextMenu>
      </ScrollArea>
    </template>
  </div>
</template>
