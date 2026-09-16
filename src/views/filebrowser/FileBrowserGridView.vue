<script setup lang="ts">
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { storeToRefs } from 'pinia';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import { useFileBrowserContext } from '@/composables/file-browser/use-file-browser-context';
import { useReactiveIcon } from '@/composables/useReactiveIcon';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import type { DirEntry } from '@/types/dir-entry';
import type { GroupedEntries } from '@/types/file-browser';
import { formatBytes } from '@/utils/byte-parser';
import { isImageFile, isVideoFile } from '@/utils/files';
import { getImageSrc } from '@/utils/images';

interface Props {
	entries: DirEntry[];
}

const props = defineProps<Props>();
const { t } = useI18n();
const ctx = useFileBrowserContext();
const clipboardStore = useClipboardStore();
const dirSizesStore = useDirSizesStore();
const { clipboardItems, clipboardType, isToolbarSuppressed } = storeToRefs(clipboardStore);

const fileIcon = useReactiveIcon(() => getIconSource('text-x-generic'));
const fileImageIcon = useReactiveIcon(() => getIconSource('image-x-generic'));
const fileVideoIcon = useReactiveIcon(() => getIconSource('video-x-generic'));
const loaderIcon = useReactiveIcon(() => getIconSource('process-working'));
const folderIcon = useReactiveIcon(() => getIconSource('folder'));

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

function handleEntryKeydown(event: KeyboardEvent): void {
	if (event.code === 'Space') {
		event.preventDefault();
	}
}

function getDirSizeDisplay(entry: DirEntry): string | null {
	const sizeInfo = dirSizesStore.getSize(entry.path);
	const itemCountStr =
		entry.item_count !== null ? `fileBrowser.itemCount ${entry.item_count}` : null;

	if (!sizeInfo) {
		return itemCountStr || '—';
	}

	if (sizeInfo.status === 'Loading') {
		if (sizeInfo.size > 0) {
			const progressStr = formatBytes(sizeInfo.size);
			return itemCountStr ? `${itemCountStr} · ${progressStr}` : progressStr;
		}

		return itemCountStr || null;
	}

	if (sizeInfo.status === 'Complete') {
		const sizeStr = formatBytes(sizeInfo.size);
		return itemCountStr ? `${itemCountStr} · ${sizeStr}` : sizeStr;
	}

	return itemCountStr || '—';
}

function shouldShowSizeSkeleton(entry: DirEntry): boolean {
	const sizeInfo = dirSizesStore.getSize(entry.path);

	return !!(sizeInfo && sizeInfo.status === 'Loading' && sizeInfo.size === 0);
}

function isDirLoadingWithProgress(entry: DirEntry): boolean {
	const sizeInfo = dirSizesStore.getSize(entry.path);
	return !!(sizeInfo && sizeInfo.status === 'Loading' && sizeInfo.size > 0);
}

const groupedEntries = computed<GroupedEntries>(() => {
	const dirs: DirEntry[] = [];
	const images: DirEntry[] = [];
	const videos: DirEntry[] = [];
	const others: DirEntry[] = [];

	for (const entry of props.entries) {
		if (entry.is_dir) {
			dirs.push(entry);
		} else if (isImageFile(entry)) {
			images.push(entry);
		} else if (isVideoFile(entry)) {
			videos.push(entry);
		} else {
			others.push(entry);
		}
	}

	return {
		dirs,
		images,
		videos,
		others,
	};
});

/**
 * En cuántas columnas se acomoda cada sección.
 *
 * Las flechas lo necesitan para saber qué hay arriba y abajo sin medir cada
 * tarjeta — ver `recorrido-visual`. No se recalcula la cuenta de `auto-fill` a
 * mano: se le pregunta al navegador cuántas pistas resolvió, que es exacto y no
 * se desincroniza si mañana cambia el `minmax()` del CSS.
 */
const rejillas = ref<Record<keyof GroupedEntries, HTMLElement | null>>({
	dirs: null,
	images: null,
	videos: null,
	others: null,
});

const columnas = ref<Record<keyof GroupedEntries, number>>({
	dirs: 1,
	images: 1,
	videos: 1,
	others: 1,
});

function setRejilla(grupo: keyof GroupedEntries, element: Element | null) {
	rejillas.value[grupo] = element instanceof HTMLElement ? element : null;
}

function medirColumnas() {
	for (const grupo of Object.keys(rejillas.value) as (keyof GroupedEntries)[]) {
		const element = rejillas.value[grupo];

		if (!element) {
			columnas.value[grupo] = 1;
			continue;
		}

		const pistas = getComputedStyle(element).gridTemplateColumns.trim();
		// Con la sección oculta o sin medir todavía, `none` es la respuesta.
		columnas.value[grupo] = pistas && pistas !== 'none' ? pistas.split(/\s+/).length : 1;
	}

	informar();
}

function informar() {
	ctx.registrarSeccionesVisuales([
		{ entradas: groupedEntries.value.dirs, columnas: columnas.value.dirs },
		{ entradas: groupedEntries.value.images, columnas: columnas.value.images },
		{ entradas: groupedEntries.value.videos, columnas: columnas.value.videos },
		{ entradas: groupedEntries.value.others, columnas: columnas.value.others },
	]);
}

let observador: ResizeObserver | null = null;

onMounted(() => {
	medirColumnas();

	if (typeof ResizeObserver !== 'undefined') {
		observador = new ResizeObserver(() => medirColumnas());

		for (const element of Object.values(rejillas.value)) {
			if (element) observador.observe(element);
		}
	}
});

// Cambiar de directorio cambia qué secciones existen, y una sección que
// aparece es una rejilla nueva que hay que medir y vigilar.
watch(groupedEntries, async () => {
	await nextTick();

	if (observador) {
		observador.disconnect();

		for (const element of Object.values(rejillas.value)) {
			if (element) observador.observe(element);
		}
	}

	medirColumnas();
});

onBeforeUnmount(() => {
	observador?.disconnect();
	observador = null;
});
</script>

<template>
  <div :key="ctx.currentPath.value" class="flex flex-col p-2 pr-4 gap-3 animate-in fade-in duration-200 h-[calc(100vh-144px)]">
    <template v-if="groupedEntries.dirs.length > 0">
      <div class="sticky z-5 top-0 flex items-center py-2 px-3 rounded-corner backdrop-blur bg-ui-surface text-tx-muted text-xs font-medium gap-2 uppercase">
        <img :src="folderIcon" class="w-4 h-4" />
        <span>{{ t('fileBrowser.folders') }}</span>
        <span class="py-0.5 px-2 rounded-corner bg-ui-bg/80 text-[11px]">{{ groupedEntries.dirs.length }}</span>
      </div>
      <div :ref="(el) => setRejilla('dirs', el as Element | null)" class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
        <button v-for="entry in groupedEntries.dirs" :key="entry.path"
          class="relative flex overflow-hidden border border-ui-border rounded-corner bg-ui-bg/80 cursor-default text-left focus-visible:outline-none group h-18 !flex-row items-center py-2 px-3 gap-2.5"
          :class="{ 'opacity-50': entry.is_hidden }" :data-entry-path="entry.path"
          :data-selected="ctx.isEntrySelected(entry) || undefined"
          :data-in-clipboard="clipboardPathsMap.has(entry.path) || undefined"
          :data-clipboard-type="clipboardPathsMap.get(entry.path) || undefined" data-drop-target
          @mousedown="ctx.onEntryMouseDown(entry, $event)" @mouseup="ctx.onEntryMouseUp(entry, $event)"
          @contextmenu="ctx.openEntryContextMenu(entry, $event)" @keydown="handleEntryKeydown">
          <div class="absolute z-3 inset-0 pointer-events-none">
            <div class="absolute inset-0 rounded-corner pointer-events-none opacity-0 group-data-[selected]:opacity-100 group-data-[selected]:bg-primary/12 group-data-[selected]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.5)] group-data-[in-clipboard]:opacity-0" />
            <div class="absolute inset-0 rounded-corner pointer-events-none opacity-0 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:opacity-100 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:bg-status-success/5 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:shadow-[inset_0_0_0_2px_hsl(var(--success)/0.4)] group-data-[in-clipboard]:group-data-[clipboard-type='move']:opacity-100 group-data-[in-clipboard]:group-data-[clipboard-type='move']:bg-status-warning/5 group-data-[in-clipboard]:group-data-[clipboard-type='move']:shadow-[inset_0_0_0_2px_hsl(var(--warning)/0.4)] group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='copy']:bg-status-success/10 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='copy']:shadow-[inset_0_0_0_2px_hsl(var(--success)/0.6)] group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:bg-status-warning/10 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:shadow-[inset_0_0_0_2px_hsl(var(--warning)/0.6)]" />
            <div class="absolute inset-0 rounded-corner pointer-events-none bg-tx-main/5 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:duration-0 group-data-[drag-over]:bg-primary/15 group-data-[drag-over]:shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.6)] group-data-[drag-over]:opacity-100 group-data-[drag-over]:duration-0" />
          </div>
          <div class="relative z-1 flex w-auto h-auto shrink-0 items-center justify-center">
            <EntryIconComponent :entry="entry" :size="24"
              class="text-primary h-6 w-6" />
          </div>
          <div class="relative z-1 overflow-hidden min-w-0 flex-1 flex flex-col gap-0.5 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
            <span class="overflow-hidden text-[13px] font-medium break-words text-ellipsis whitespace-nowrap">{{ entry.name }}</span>
            <div class="flex items-center text-[11px] gap-1.5 text-tx-muted opacity-100 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
              <img :src="loaderIcon" v-if="isDirLoadingWithProgress(entry)" :size="12"
                class="shrink-0 animate-spin text-tx-muted" />
              <span class="inline-flex items-center">
                <template v-if="getDirSizeDisplay(entry)">{{ getDirSizeDisplay(entry) }}</template>
                <template v-if="shouldShowSizeSkeleton(entry)">
                  <span v-if="entry.item_count !== null" class="after:content-['_\·_']" />
                  <Skeleton class="w-10 h-[11px]" />
                </template>
              </span>
            </div>
          </div>
        </button>
      </div>
    </template>

    <template v-if="groupedEntries.images.length > 0">
      <div class="sticky z-5 top-0 flex items-center py-2 px-3 rounded-corner backdrop-blur bg-ui-surface text-tx-muted text-xs font-medium gap-2 uppercase">
        <img :src="fileImageIcon" class="w-4 h-4" />
        <span>{{ t('fileBrowser.images') }}</span>
        <span class="py-0.5 px-2 rounded-[10px] bg-ui-bg/80-3 text-[11px]">{{ groupedEntries.images.length }}</span>
      </div>
      <div :ref="(el) => setRejilla('images', el as Element | null)" class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        <button v-for="entry in groupedEntries.images" :key="entry.path"
          class="relative flex overflow-hidden flex-col border border-ui-border rounded-corner bg-ui-bg/80 cursor-default text-left focus-visible:outline-none group h-[120px]"
          :class="{ 'opacity-50': entry.is_hidden }" :data-entry-path="entry.path"
          :data-selected="ctx.isEntrySelected(entry) || undefined"
          :data-in-clipboard="clipboardPathsMap.has(entry.path) || undefined"
          :data-clipboard-type="clipboardPathsMap.get(entry.path) || undefined"
          @mousedown="ctx.onEntryMouseDown(entry, $event)" @mouseup="ctx.onEntryMouseUp(entry, $event)"
          @contextmenu="ctx.openEntryContextMenu(entry, $event)" @keydown="handleEntryKeydown">
          <div class="absolute z-3 inset-0 pointer-events-none">
            <div class="absolute inset-0 rounded-corner pointer-events-none opacity-0 group-data-[selected]:opacity-100 group-data-[selected]:bg-primary/30 group-data-[selected]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.5)] group-data-[in-clipboard]:opacity-0" />
            <div class="absolute inset-0 rounded-corner pointer-events-none opacity-0 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:opacity-100 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:bg-status-success/15 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:shadow-[inset_0_0_0_2px_hsl(var(--success)/0.4)] group-data-[in-clipboard]:group-data-[clipboard-type='move']:opacity-100 group-data-[in-clipboard]:group-data-[clipboard-type='move']:bg-status-warning/15 group-data-[in-clipboard]:group-data-[clipboard-type='move']:shadow-[inset_0_0_0_2px_hsl(var(--warning)/0.4)] group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='copy']:bg-status-success/10 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='copy']:shadow-[inset_0_0_0_2px_hsl(var(--success)/0.6)] group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:bg-status-warning/10 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:shadow-[inset_0_0_0_2px_hsl(var(--warning)/0.6)]" />
            <div class="absolute inset-0 rounded-corner pointer-events-none bg-tx-main/5 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:duration-0 group-data-[drag-over]:bg-primary/15 group-data-[drag-over]:shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.6)] group-data-[drag-over]:opacity-100 group-data-[drag-over]:duration-0" />
          </div>
          <div class="relative z-1 flex w-full h-full items-center justify-center">
            <img :src="getImageSrc(entry)" :alt="entry.name" class="w-full h-full object-cover pointer-events-none" loading="lazy">
          </div>
          <div class="absolute z-2 inset-x-0 bottom-0 py-2 px-2.5 bg-linear-to-t from-black/80 to-transparent text-white flex flex-col gap-0.5 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
            <span class="overflow-hidden text-[13px] font-medium break-words text-ellipsis whitespace-nowrap">{{ entry.name }}</span>
            <div class="flex items-center text-[11px] gap-1.5 opacity-80 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
              <span class="file-browser-grid-view__card-type">{{ entry.ext?.toUpperCase() }}</span>
              <span class="inline-flex items-center">{{ formatBytes(entry.size) }}</span>
            </div>
          </div>
        </button>
      </div>
    </template>

    <template v-if="groupedEntries.videos.length > 0">
      <div class="sticky z-5 top-0 flex items-center py-2 px-3 rounded-corner backdrop-blur bg-ui-surface text-tx-muted text-xs font-medium gap-2 uppercase">
        <img :src="fileVideoIcon" class="w-4 h-4" />
        <span>{{ t('fileBrowser.videos') }}</span>
        <span class="py-0.5 px-2 rounded-[10px] bg-ui-bg/80-3 text-[11px]">{{ groupedEntries.videos.length }}</span>
      </div>
      <div :ref="(el) => setRejilla('videos', el as Element | null)" class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        <button v-for="entry in groupedEntries.videos" :key="entry.path"
          class="relative flex overflow-hidden flex-col border border-ui-border rounded-corner bg-ui-bg/80 cursor-default text-left focus-visible:outline-none group h-[120px]"
          :class="{
            'opacity-50': entry.is_hidden,
          }" :data-entry-path="entry.path" :data-selected="ctx.isEntrySelected(entry) || undefined"
          :data-in-clipboard="clipboardPathsMap.has(entry.path) || undefined"
          :data-clipboard-type="clipboardPathsMap.get(entry.path) || undefined"
          @mousedown="ctx.onEntryMouseDown(entry, $event)" @mouseup="ctx.onEntryMouseUp(entry, $event)"
          @contextmenu="ctx.openEntryContextMenu(entry, $event)" @keydown="handleEntryKeydown">
          <div class="absolute z-3 inset-0 pointer-events-none">
            <div v-if="ctx.getVideoThumbnail(entry)" class="absolute inset-0 rounded-corner pointer-events-none opacity-0 group-data-[selected]:opacity-100 group-data-[selected]:bg-primary/30 group-data-[selected]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.5)] group-data-[in-clipboard]:opacity-0" />
            <div v-else class="absolute inset-0 rounded-corner pointer-events-none opacity-0 group-data-[selected]:opacity-100 group-data-[selected]:bg-primary/12 group-data-[selected]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.5)] group-data-[in-clipboard]:opacity-0" />
            
            <div v-if="ctx.getVideoThumbnail(entry)" class="absolute inset-0 rounded-corner pointer-events-none opacity-0 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:opacity-100 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:bg-status-success/15 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:shadow-[inset_0_0_0_2px_hsl(var(--success)/0.4)] group-data-[in-clipboard]:group-data-[clipboard-type='move']:opacity-100 group-data-[in-clipboard]:group-data-[clipboard-type='move']:bg-status-warning/15 group-data-[in-clipboard]:group-data-[clipboard-type='move']:shadow-[inset_0_0_0_2px_hsl(var(--warning)/0.4)] group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='copy']:bg-status-success/10 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='copy']:shadow-[inset_0_0_0_2px_hsl(var(--success)/0.6)] group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:bg-status-warning/10 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:shadow-[inset_0_0_0_2px_hsl(var(--warning)/0.6)]" />
            <div v-else class="absolute inset-0 rounded-corner pointer-events-none opacity-0 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:opacity-100 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:bg-status-success/5 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:shadow-[inset_0_0_0_2px_hsl(var(--success)/0.4)] group-data-[in-clipboard]:group-data-[clipboard-type='move']:opacity-100 group-data-[in-clipboard]:group-data-[clipboard-type='move']:bg-status-warning/5 group-data-[in-clipboard]:group-data-[clipboard-type='move']:shadow-[inset_0_0_0_2px_hsl(var(--warning)/0.4)] group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='copy']:bg-status-success/10 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='copy']:shadow-[inset_0_0_0_2px_hsl(var(--success)/0.6)] group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:bg-status-warning/10 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:shadow-[inset_0_0_0_2px_hsl(var(--warning)/0.6)]" />

            <div class="absolute inset-0 rounded-corner pointer-events-none bg-tx-main/5 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:duration-0 group-data-[drag-over]:bg-primary/15 group-data-[drag-over]:shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.6)] group-data-[drag-over]:opacity-100 group-data-[drag-over]:duration-0" />
          </div>
          <div :class="[
            ctx.getVideoThumbnail(entry) ? 'relative z-1 flex w-full h-full items-center justify-center' : 'absolute top-2 left-2 w-12 h-12 bg-transparent'
          ]">
            <img v-if="ctx.getVideoThumbnail(entry)" :src="ctx.getVideoThumbnail(entry)" :alt="entry.name"
              class="w-full h-full object-cover pointer-events-none">
            <img v-else :src="fileVideoIcon" class="text-tx-muted w-12 h-12" />
          </div>
          <div class="absolute z-2 inset-x-0 bottom-0 py-2 px-2.5 bg-linear-to-t from-black/80 to-transparent text-white flex flex-col gap-0.5 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
            <span class="overflow-hidden text-[13px] font-medium break-words text-ellipsis whitespace-nowrap">{{ entry.name }}</span>
            <div class="flex items-center text-[11px] gap-1.5 opacity-80 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
              <span class="file-browser-grid-view__card-type">{{ t('fileBrowser.video') }}</span>
              <span class="inline-flex items-center">{{ formatBytes(entry.size) }}</span>
            </div>
          </div>
        </button>
      </div>
    </template>

    <template v-if="groupedEntries.others.length > 0">
      <div class="sticky z-5 top-0 flex items-center py-2 px-3 rounded-corner backdrop-blur bg-ui-surface text-tx-muted text-xs font-medium gap-2 uppercase">
        <img :src="fileIcon" class="w-4 h-4" />
        <span>{{ t('fileBrowser.otherFiles') }}</span>
        <span class="py-0.5 px-2 rounded-[10px] bg-ui-bg/80-3 text-[11px]">{{ groupedEntries.others.length }}</span>
      </div>
      <div :ref="(el) => setRejilla('others', el as Element | null)" class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        <button v-for="entry in groupedEntries.others" :key="entry.path"
          class="relative flex overflow-hidden flex-col border border-ui-border rounded-corner bg-ui-bg/80 cursor-default text-left focus-visible:outline-none group h-[120px]"
          :class="{ 'opacity-50': entry.is_hidden }" :data-entry-path="entry.path"
          :data-selected="ctx.isEntrySelected(entry) || undefined"
          :data-in-clipboard="clipboardPathsMap.has(entry.path) || undefined"
          :data-clipboard-type="clipboardPathsMap.get(entry.path) || undefined"
          @mousedown="ctx.onEntryMouseDown(entry, $event)" @mouseup="ctx.onEntryMouseUp(entry, $event)"
          @contextmenu="ctx.openEntryContextMenu(entry, $event)" @keydown="handleEntryKeydown">
          <div class="absolute z-3 inset-0 pointer-events-none">
            <div class="absolute inset-0 rounded-corner pointer-events-none opacity-0 group-data-[selected]:opacity-100 group-data-[selected]:bg-primary/12 group-data-[selected]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.5)] group-data-[in-clipboard]:opacity-0" />
            <div class="absolute inset-0 rounded-corner pointer-events-none opacity-0 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:opacity-100 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:bg-status-success/5 group-data-[in-clipboard]:group-data-[clipboard-type='copy']:shadow-[inset_0_0_0_2px_hsl(var(--success)/0.4)] group-data-[in-clipboard]:group-data-[clipboard-type='move']:opacity-100 group-data-[in-clipboard]:group-data-[clipboard-type='move']:bg-status-warning/5 group-data-[in-clipboard]:group-data-[clipboard-type='move']:shadow-[inset_0_0_0_2px_hsl(var(--warning)/0.4)] group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='copy']:bg-status-success/10 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='copy']:shadow-[inset_0_0_0_2px_hsl(var(--success)/0.6)] group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:bg-status-warning/10 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:shadow-[inset_0_0_0_2px_hsl(var(--warning)/0.6)]" />
            <div class="absolute inset-0 rounded-corner pointer-events-none bg-tx-main/5 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:duration-0 group-data-[drag-over]:bg-primary/15 group-data-[drag-over]:shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.6)] group-data-[drag-over]:opacity-100 group-data-[drag-over]:duration-0" />
          </div>
          <div class="absolute top-2 left-2 w-12 h-12 bg-transparent">
            <EntryIconComponent :entry="entry" :size="48" class="text-tx-muted w-12 h-12" />
          </div>
          <div class="absolute z-2 inset-x-0 bottom-0 py-2 px-2.5 text-tx-main flex flex-col gap-0.5 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
            <span class="overflow-hidden text-[13px] font-medium break-words text-ellipsis whitespace-nowrap">{{ entry.name }}</span>
            <div class="flex items-center text-[11px] gap-1.5 opacity-80 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
              <span class="file-browser-grid-view__card-type">{{ entry.ext?.toUpperCase() || 'file' }}</span>
              <span class="inline-flex items-center">{{ formatBytes(entry.size) }}</span>
            </div>
          </div>
        </button>
      </div>
    </template>
  </div>
</template>
