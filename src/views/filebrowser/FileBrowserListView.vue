<script setup lang="ts">
import { getSymbolSource } from '@vasakgroup/plugin-vicons';
import { storeToRefs } from 'pinia';
import { computed, onMounted, type Ref, ref } from 'vue';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import { useFileBrowserContext } from '@/composables/file-browser/use-file-browser-context';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import type { DirEntry } from '@/types/dir-entry';
import { formatBytes } from '@/utils/byte-parser';
import { formatDate } from '@/utils/date-formatter';

interface Props {
	entries: DirEntry[];
}

const props = defineProps<Props>();

const ctx = useFileBrowserContext();
const selectedIcon = ref('');
const loaderCircleIcon = ref('');
const clipboardStore = useClipboardStore();
const dirSizesStore = useDirSizesStore();
const { clipboardItems, clipboardType, isToolbarSuppressed } = storeToRefs(clipboardStore);

const columnVisibility: Ref<{ items: boolean; size: boolean; modified: boolean }> = ref({
	items: true,
	size: true,
	modified: true,
});
const showItemsColumn = computed(() => columnVisibility.value.items);
const showSizeColumn = computed(() => columnVisibility.value.size);
const showModifiedColumn = computed(() => columnVisibility.value.modified);

const clipboardPathsMap = computed(() => {
	if (isToolbarSuppressed.value) {
		return new Map<string, string>();
	}

	const map = new Map<string, string>();

	for (const item of clipboardItems.value) {
		map.set(item.path, clipboardType.value || '');
	}

	return map;
});

function getSizeDisplay(entry: DirEntry): string | null {
	if (entry.is_file) {
		return formatBytes(entry.size);
	}

	const sizeInfo = dirSizesStore.getSize(entry.path);

	if (!sizeInfo) {
		return '—';
	}

	if (sizeInfo.status === 'Loading') {
		if (sizeInfo.size > 0) {
			return formatBytes(sizeInfo.size);
		}

		return null;
	}

	return formatBytes(sizeInfo.size);
}

function getItemsDisplay(entry: DirEntry): string {
	if (entry.is_file) {
		return '—';
	}

	return entry.item_count !== null ? `${entry.item_count} items` : '—';
}

function isDirLoadingWithProgress(entry: DirEntry): boolean {
	if (entry.is_file) return false;
	const sizeInfo = dirSizesStore.getSize(entry.path);
	return !!(sizeInfo && sizeInfo.status === 'Loading' && sizeInfo.size > 0);
}

function handleEntryKeydown(event: KeyboardEvent): void {
	if (event.code === 'Space') {
		event.preventDefault();
	}
}

onMounted(async () => {
	selectedIcon.value = await getSymbolSource('object-select-symbolic');
	loaderCircleIcon.value = await getSymbolSource('content-loading-symbolic');
});
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-210px)]" style="padding-right: var(--file-browser-list-right-gutter);">
    <div :key="ctx.currentPath.value" class="flex flex-col">
      <button v-for="entry in props.entries" :key="entry.path" class="relative grid border-b border-ui-border text-left hover:bg-ui-bg/80 group focus-visible:outline-none data-[drag-over]:bg-primary/5" :class="{
        'opacity-50': entry.is_hidden,
      }" :data-entry-path="entry.path" :data-selected="ctx.isEntrySelected(entry) || undefined"
        :data-in-clipboard="clipboardPathsMap.has(entry.path) || undefined"
        :data-clipboard-type="clipboardPathsMap.get(entry.path) || undefined"
        :data-drop-target="entry.is_dir || undefined" @mousedown="ctx.onEntryMouseDown(entry, $event)"
        @mouseup="ctx.onEntryMouseUp(entry, $event)" @contextmenu.prevent="ctx.handleEntryContextMenu(entry)"
        @keydown="handleEntryKeydown"
        style="grid-template-columns: var(--file-browser-list-columns); padding: var(--file-browser-list-row-padding-y) var(--file-browser-list-row-padding-x);">
        <div class="absolute inset-0 z-0 pointer-events-none">
          <div class="absolute inset-0 pointer-events-none opacity-0 data-[in-clipboard]:data-[clipboard-type='copy']:opacity-100 data-[in-clipboard]:data-[clipboard-type='copy']:bg-success/5 data-[in-clipboard]:data-[clipboard-type='copy']:shadow-[inset_0_0_0_1px_hsl(var(--success)/0.3),inset_3px_0_0_0_hsl(var(--success)/0.5)] data-[selected]:data-[in-clipboard]:data-[clipboard-type='copy']:bg-success/10 data-[selected]:data-[in-clipboard]:data-[clipboard-type='copy']:shadow-[inset_0_0_0_1px_hsl(var(--success)/0.5),inset_3px_0_0_0_hsl(var(--success)/0.7)] data-[in-clipboard]:data-[clipboard-type='move']:opacity-100 data-[in-clipboard]:data-[clipboard-type='move']:bg-warning/5 data-[in-clipboard]:data-[clipboard-type='move']:shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.3),inset_3px_0_0_0_hsl(var(--warning)/0.5)] data-[selected]:data-[in-clipboard]:data-[clipboard-type='move']:bg-warning/10 data-[selected]:data-[in-clipboard]:data-[clipboard-type='move']:shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.5),inset_3px_0_0_0_hsl(var(--warning)/0.7)]" />
          <div class="absolute inset-0 pointer-events-none bg-foreground/5 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:duration-0 group-data-[drag-over]:bg-primary/15 group-data-[drag-over]:shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.6)] group-data-[drag-over]:opacity-100 group-data-[drag-over]:duration-0" />
        </div>
        <div class="relative z-10 flex overflow-hidden items-center pr-4 gap-2.5 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-warning">
          <img v-if="ctx.isEntrySelected(entry)" :src="selectedIcon" alt="Selected" class="h-4 w-4" />
          <EntryIconComponent :entry="entry" :size="18" class="h-4 w-4 shrink-0 text-muted-foreground" :class="{'text-primary': entry.is_dir}" />
          <div class="flex overflow-hidden min-w-0 flex-1 flex-col gap-0.5">
            <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ entry.name }}</span>
            <span v-if="ctx.entryDescription?.(entry)" class="overflow-hidden text-muted-foreground text-[11px] text-ellipsis whitespace-nowrap">{{
              ctx.entryDescription!(entry) }}</span>
          </div>
        </div>
        <span v-if="showItemsColumn" class="relative z-10 overflow-hidden pr-[var(--file-browser-list-cell-padding-right)] text-muted-foreground text-xs text-ellipsis whitespace-nowrap group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-warning">
          {{ getItemsDisplay(entry) }}
        </span>
        <span v-if="showSizeColumn" class="relative z-10 flex items-center gap-1.5 overflow-hidden pr-[var(--file-browser-list-cell-padding-right)] text-muted-foreground text-xs text-ellipsis whitespace-nowrap group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-warning">
          <img :src="loaderCircleIcon" alt="loading" v-if="isDirLoadingWithProgress(entry)" :size="12" class="shrink-0 animate-spin text-muted-foreground" />
          <Skeleton v-if="getSizeDisplay(entry) === null" class="w-[50px] h-3" />
          <template v-else>{{ getSizeDisplay(entry) }}</template>
        </span>
        <span v-if="showModifiedColumn" class="relative z-10 overflow-hidden pr-[var(--file-browser-list-cell-padding-right)] text-muted-foreground text-xs text-ellipsis whitespace-nowrap group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-warning">
          {{ formatDate(entry.modified_time) }}
        </span>
      </button>
    </div>
  </div>
</template>
