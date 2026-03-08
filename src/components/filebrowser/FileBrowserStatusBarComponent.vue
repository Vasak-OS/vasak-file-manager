<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, nextTick, ref, watch } from 'vue';
import FileBrowserActionMenuComponent from '@/components/filebrowser/FileBrowserActionMenuComponent.vue';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu.vue';
import DropdownMenuContent from '@/components/ui/dropdown/DropdownMenuContent.vue';
import DropdownMenuItem from '@/components/ui/dropdown/DropdownMenuItem.vue';
import DropdownMenuSeparator from '@/components/ui/dropdown/DropdownMenuSeparator.vue';
import DropdownMenuTrigger from '@/components/ui/dropdown/DropdownMenuTrigger.vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverAnchor from '@/components/ui/popover/PopoverAnchor.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import type { ContextMenuAction } from '@/types/contextMenu';
import type { DirContents, DirEntry } from '@/types/dir-entry';
import { formatBytes } from '@/utils/byte-parser';

const MAX_VISIBLE_ITEMS = 100;

const props = defineProps<{
	dirContents: DirContents | null;
	filteredCount: number;
	selectedCount?: number;
	selectedEntries?: DirEntry[];
}>();

const emit = defineEmits<{
	selectAll: [];
	deselectAll: [];
	removeFromSelection: [entry: DirEntry];
	contextMenuAction: [action: ContextMenuAction];
}>();

const dirSizesStore = useDirSizesStore();
const { t } = useI18n();

const showItemsPopoverOpen = ref(false);
const itemsFilterQuery = ref('');

const totalCount = computed(() => props.dirContents?.entries.length ?? 0);

const isFiltered = computed(() => props.filteredCount !== totalCount.value);
const hiddenCount = computed(() => Math.max(totalCount.value - props.filteredCount, 0));
const hasSelection = computed(() => (props.selectedCount ?? 0) > 0);

const selectedEntriesArray = computed(() => props.selectedEntries ?? []);

const selectionStats = computed(() => {
	const entries = selectedEntriesArray.value;
	if (entries.length === 0) return null;

	let totalSize = 0;
	let fileCount = 0;
	let dirCount = 0;
	let hasUnknownSize = false;

	for (const entry of entries) {
		if (entry.is_file) {
			fileCount++;
			totalSize += entry.size;
		} else if (entry.is_dir) {
			dirCount++;
			const dirSizeInfo = dirSizesStore.getSize(entry.path);

			if (dirSizeInfo && dirSizeInfo.status === 'Complete') {
				totalSize += dirSizeInfo.size;
			} else {
				hasUnknownSize = true;
			}
		}
	}

	return {
		totalSize,
		fileCount,
		dirCount,
		hasUnknownSize,
	};
});

const selectionSizeDisplay = computed(() => {
	if (!selectionStats.value) return null;

	const { totalSize, fileCount, dirCount, hasUnknownSize } = selectionStats.value;

	const parts = [];

	if (fileCount > 0) {
		parts.push(`fileBrowser.fileCount ${fileCount}`);
	}

	if (dirCount > 0) {
		parts.push(`fileBrowser.directoryCount ${dirCount}`);
	}

	const countStr = parts.join(', ');

	const sizeStr = hasUnknownSize ? null : formatBytes(totalSize);

	return {
		sizeStr,
		countStr,
	};
});

const filteredSelectedEntries = computed(() => {
	if (!itemsFilterQuery.value) {
		return selectedEntriesArray.value;
	}

	const query = itemsFilterQuery.value.toLowerCase();
	return selectedEntriesArray.value.filter(
		(entry) => entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query)
	);
});

const displayedEntries = computed(() => {
	return filteredSelectedEntries.value.slice(0, MAX_VISIBLE_ITEMS);
});

const showItemsHeader = computed(() => {
	const total = selectedEntriesArray.value.length;
	const matched = filteredSelectedEntries.value.length;
	const displayed = Math.min(matched, MAX_VISIBLE_ITEMS);

	if (itemsFilterQuery.value) {
		return `fileBrowser.matchedNOfItems ${matched} ${total}`;
	}

	if (total > MAX_VISIBLE_ITEMS) {
		const hidden = Math.max(total - displayed, 0);

		return `fileBrowser.showingNOfItems ${hidden} ${total}`;
	}

	return null;
});

watch(showItemsPopoverOpen, (isOpen) => {
	if (!isOpen) {
		itemsFilterQuery.value = '';
	}
});

watch(
	() => props.selectedEntries?.length,
	(length) => {
		if (length === 0) {
			showItemsPopoverOpen.value = false;
		}
	}
);

function removeItem(entry: DirEntry) {
	emit('removeFromSelection', entry);
}

function openCollapsedPopover() {
	nextTick(() => {
		setTimeout(() => {
			showItemsPopoverOpen.value = true;
		}, 200);
	});
}
</script>

<template>
  <div class="@container flex h-8 shrink-0 items-center justify-between px-2 py-1 rounded-[var(--radius-sm)] border-t border-ui-border bg-ui-bg/80-2 text-muted-foreground text-xs gap-2">
    <template v-if="hasSelection">
      <span class="flex shrink-0 flex-wrap items-center gap-1">
        {{ t('fileBrowser.selectedItems').replace('{0}', String(selectedCount)) }}
        <template v-if="selectionSizeDisplay">
          <span class="text-muted-foreground/50">·</span>
          <span class="font-medium">
            <template v-if="selectionSizeDisplay.sizeStr">
              {{ selectionSizeDisplay.sizeStr }}
              <span v-if="selectionSizeDisplay.countStr" class="text-muted-foreground font-normal">({{
                selectionSizeDisplay.countStr }})</span>
            </template>
            <template v-else>
              {{ selectionSizeDisplay.countStr }}
            </template>
          </span>
        </template>
      </span>
      <Popover v-model:open="showItemsPopoverOpen">
        <PopoverAnchor as-child>
          <div class="flex shrink-0 items-center gap-1">
            <div class="hidden @[400px]:flex items-center gap-1">
              <button type="button" class="inline-flex items-center h-[26px] px-2 text-[11px] gap-1 rounded hover:bg-muted/50 outline-none" :title="t('showItems')"
                @click="showItemsPopoverOpen = true">
                <EyeIcon :size="14" />
                <span class="hidden @[600px]:inline">{{ t('showItems') }}</span>
              </button>

              <button type="button" class="inline-flex items-center h-[26px] px-2 text-[11px] gap-1 rounded hover:bg-muted/50 outline-none"
                :title="t('fileBrowser.selectAll')" @click="emit('selectAll')">
                <CheckCheckIcon :size="14" />
                <span class="hidden @[600px]:inline">{{ t('fileBrowser.selectAll') }}</span>
              </button>

              <button type="button" class="inline-flex items-center h-[26px] px-2 text-[11px] gap-1 rounded hover:bg-muted/50 outline-none"
                :title="t('fileBrowser.deselectAll')" @click="emit('deselectAll')">
                <XIcon :size="14" />
                <span class="hidden @[600px]:inline">{{ t('fileBrowser.deselectAll') }}</span>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button type="button" class="inline-flex items-center h-[26px] px-2 text-[11px] gap-1 rounded hover:bg-muted/50 outline-none" :title="t('menu')">
                    <MenuIcon :size="14" />
                    <span class="hidden @[600px]:inline">{{ t('menu') }}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" class="w-[200px] p-2">
                  <FileBrowserActionMenuComponent :selected-entries="selectedEntriesArray"
                    :menu-item-component="DropdownMenuItem" :menu-separator-component="DropdownMenuSeparator"
                    @action="emit('contextMenuAction', $event)" />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div class="flex @[400px]:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button type="button" class="inline-flex items-center h-[26px] px-2 text-[11px] gap-1 rounded hover:bg-muted/50 outline-none" :title="t('actions')">
                    <EllipsisVerticalIcon :size="16" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" class="min-w-[180px]">
                  <DropdownMenuItem @click="openCollapsedPopover">
                    <EyeIcon :size="14" />
                    {{ t('showItems') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="emit('selectAll')">
                    <CheckCheckIcon :size="14" />
                    {{ t('fileBrowser.selectAll') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="emit('deselectAll')">
                    <XIcon :size="14" />
                    {{ t('fileBrowser.deselectAll') }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <FileBrowserActionMenuComponent :selected-entries="selectedEntriesArray"
                    :menu-item-component="DropdownMenuItem" :menu-separator-component="DropdownMenuSeparator"
                    @action="emit('contextMenuAction', $event)" />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent align="start" side="top" class="w-[320px] p-0">
          <div class="flex flex-col gap-2">
            <div class="px-2 pt-2">
              <input v-model="itemsFilterQuery" type="text" :placeholder="t('filter.filter')"
                class="w-full flex h-8 w-full rounded-md border border-input bg-ui-bg/80 px-3 py-1.5 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" />
            </div>
            <div v-if="showItemsHeader" class="px-3 py-1 text-muted-foreground text-[11px]">
              {{ showItemsHeader }}
            </div>
            <ScrollArea class="h-[200px] [&_.sigma-ui-scroll-area-scrollbar]:-right-1.5">
              <div class="flex flex-col m-2 gap-0.5">
                <div v-for="entry in displayedEntries" :key="entry.path" class="flex items-stretch rounded gap-2 hover:bg-secondary group/item">
                  <div class="flex overflow-hidden min-w-0 flex-1 flex-col justify-center py-1.5 pl-2 gap-0.5">
                    <span class="overflow-hidden text-[13px] font-medium text-ellipsis whitespace-nowrap">{{ entry.name }}</span>
                    <span class="overflow-hidden text-muted-foreground text-[11px] text-ellipsis whitespace-nowrap">{{ entry.path }}</span>
                  </div>
                  <button type="button" class="shrink-0 self-stretch w-9 flex items-center justify-center rounded-r hover:bg-destructive hover:text-destructive-foreground outline-none transition-colors"
                    :title="t('fileBrowser.removeFromSelection')" @click="removeItem(entry)">
                    <XIcon :size="16" />
                  </button>
                </div>
                <div v-if="displayedEntries.length === 0" class="p-4 text-muted-foreground text-xs text-center">
                  {{ t('fileBrowser.noMatchingItems') }}
                </div>
              </div>
            </ScrollArea>
          </div>
        </PopoverContent>
      </Popover>
    </template>
    <template v-else>
      <span v-if="isFiltered">
        {{  `fileBrowser.showingFiltered ${ hiddenCount} , total: ${totalCount}` }}
      </span>
      <span v-else>
        {{  `fileBrowser.itemsTotal ${ totalCount }` }}
      </span>
    </template>
  </div>
</template>
