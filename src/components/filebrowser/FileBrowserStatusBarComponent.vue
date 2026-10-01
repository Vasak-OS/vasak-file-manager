<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	ListRow,
	Popover,
	PopoverAnchor,
	PopoverContent,
	SearchField,
} from '@vasakgroup/vue-libvasak';
import { computed, nextTick, ref, watch } from 'vue';
import ActionMenuComponent from '@/components/menu/ActionMenuComponent.vue';
import { useElementWidth } from '@/composables/use-element-width';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import { interpolar } from '@/tools/interpolar';
import type { ContextMenuAction } from '@/types/contextMenu';
import type { DirContents, DirEntry } from '@/types/dir-entry';
import { formatBytes } from '@/utils/byte-parser';

const MAX_VISIBLE_ITEMS = 100;

/**
 * La barra mide su lugar: por debajo de 400 píxeles los cuatro botones van a
 * un menú, y por debajo de 600 quedan con el icono solo (el nombre sigue en el
 * `aria-label` y en el globo nativo).
 */
const bar = ref<HTMLElement | null>(null);
const barWidth = useElementWidth(bar);
const isCollapsed = computed(() => barWidth.value < 400);
const showsButtonText = computed(() => barWidth.value >= 600);

function buttonLabel(text: string): string {
	return showsButtonText.value ? text : '';
}

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
		parts.push(t('fileBrowser.fileCount').replace('{0}', String(fileCount)));
	}

	if (dirCount > 0) {
		parts.push(t('fileBrowser.directoryCount').replace('{0}', String(dirCount)));
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
		return interpolar(t('fileBrowser.matchedNOfItems'), matched, total);
	}

	if (total > MAX_VISIBLE_ITEMS) {
		// `displayed` y no los escondidos, por lo mismo que en la barra del
		// portapapeles: la frase dice «Mostrando {0} de {1}».
		return interpolar(t('fileBrowser.showingNOfItems'), displayed, total);
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
  <div ref="bar" class="flex h-8 min-w-0 shrink-0 items-center justify-between gap-2 border-t border-ui-line px-2 py-1 text-label-xs text-tx-muted">
    <template v-if="hasSelection">
      <span class="flex min-w-0 flex-wrap items-center gap-1">
        {{ t('fileBrowser.selectedItems').replace('{0}', String(selectedCount)) }}
        <template v-if="selectionSizeDisplay">
          <span class="text-tx-muted/50">·</span>
          <span class="font-medium">
            <template v-if="selectionSizeDisplay.sizeStr">
              {{ selectionSizeDisplay.sizeStr }}
              <span v-if="selectionSizeDisplay.countStr" class="text-tx-muted font-normal">({{
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
            <div v-if="!isCollapsed" class="flex items-center gap-1">
              <ActionButton :label="buttonLabel(t('showItems'))" :icon-alt="t('showItems')" :title="t('showItems')"
                icon="view-reveal" variant="ghost" size="sm" @click="showItemsPopoverOpen = true" />
              <ActionButton :label="buttonLabel(t('fileBrowser.selectAll'))" :icon-alt="t('fileBrowser.selectAll')"
                :title="t('fileBrowser.selectAll')" icon="edit-select-all" variant="ghost" size="sm"
                @click="emit('selectAll')" />
              <ActionButton :label="buttonLabel(t('fileBrowser.deselectAll'))" :icon-alt="t('fileBrowser.deselectAll')"
                :title="t('fileBrowser.deselectAll')" icon="edit-select-none" variant="ghost" size="sm"
                @click="emit('deselectAll')" />

              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <ActionButton :label="buttonLabel(t('menu'))" :icon-alt="t('menu')" :title="t('menu')"
                    icon="open-menu" variant="ghost" size="sm" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" class="min-w-50">
                  <ActionMenuComponent :selected-entries="selectedEntriesArray"
                    :menu-item-component="DropdownMenuItem" :menu-separator-component="DropdownMenuSeparator"
                    @action="emit('contextMenuAction', $event)" />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <DropdownMenu v-else>
              <DropdownMenuTrigger as-child>
                <ActionButton label="" :icon-alt="t('actions')" :title="t('actions')" icon="view-more"
                  variant="ghost" size="sm" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" class="min-w-45">
                <DropdownMenuItem icon="view-reveal" @click="openCollapsedPopover">
                  {{ t('showItems') }}
                </DropdownMenuItem>
                <DropdownMenuItem icon="edit-select-all" @click="emit('selectAll')">
                  {{ t('fileBrowser.selectAll') }}
                </DropdownMenuItem>
                <DropdownMenuItem icon="edit-select-none" @click="emit('deselectAll')">
                  {{ t('fileBrowser.deselectAll') }}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <ActionMenuComponent :selected-entries="selectedEntriesArray"
                  :menu-item-component="DropdownMenuItem" :menu-separator-component="DropdownMenuSeparator"
                  @action="emit('contextMenuAction', $event)" />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </PopoverAnchor>
        <PopoverContent align="start" side="top" padding="sm" class="w-80" :label="t('showItems')">
          <div class="flex flex-col gap-2">
            <SearchField v-model="itemsFilterQuery" :placeholder="t('filter.filter')" :label="t('filter.filter')" />
            <div v-if="showItemsHeader" class="px-3 py-1 text-label-xs text-tx-muted">
              {{ showItemsHeader }}
            </div>
            <!-- La barra de desplazamiento la pone `scrollbar.css`. -->
            <div class="h-50 overflow-y-auto">
              <div class="flex flex-col gap-0.5">
                <ListRow
                  v-for="entry in displayedEntries"
                  :key="entry.path"
                  :title="entry.name"
                  :description="entry.path"
                  truncate>
                  <template #trailing>
                    <ActionButton label="" :icon-alt="t('fileBrowser.removeFromSelection')"
                      :title="t('fileBrowser.removeFromSelection')" icon="window-close" variant="ghost" size="sm"
                      @click="removeItem(entry)" />
                  </template>
                </ListRow>
                <p v-if="displayedEntries.length === 0" class="m-0 p-4 text-center text-body-xs text-tx-muted">
                  {{ t('fileBrowser.noMatchingItems') }}
                </p>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </template>
    <template v-else>
      <span v-if="isFiltered" class="truncate">
        {{ t('fileBrowser.showingFiltered').replace('{0}', String(hiddenCount)).replace('{1}', String(totalCount)) }}
      </span>
      <span v-else class="truncate">
        {{ t('fileBrowser.itemsTotal').replace('{0}', String(totalCount)) }}
      </span>
    </template>
  </div>
</template>
