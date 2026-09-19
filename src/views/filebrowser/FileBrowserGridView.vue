<script setup lang="ts">
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { storeToRefs } from 'pinia';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { RecycleScroller } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import {
	columnasQueEntran,
	enFilas,
	type Fila,
	SEPARACION_PX,
} from '@/composables/file-browser/filas-de-cuadricula';
import { useFileBrowserContext } from '@/composables/file-browser/use-file-browser-context';
import { useReactiveIcon } from '@/composables/useReactiveIcon';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';
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
	// `t()` y no la clave escrita a mano: así como estaba, cada carpeta de la
	// cuadrícula mostraba literalmente «fileBrowser.itemCount 3» en lugar de
	// «3 elementos». Y con la clave según la cantidad, porque una carpeta con
	// un solo archivo decía «1 elementos».
	const itemCountStr =
		entry.item_count !== null
			? interpolar(
					t(claveSegunCantidad('fileBrowser.itemCount', entry.item_count)),
					entry.item_count
				)
			: null;

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
 * Cada sección se dibuja por filas, y sólo las filas que se ven.
 *
 * La cuadrícula son cuatro rejillas con encabezado pegajoso, ancho mínimo y
 * alto de tarjeta propios. Virtualizar tarjeta por tarjeta obligaría a
 * calcularle la posición a cada una —el modo grilla del desplazador pide el
 * tamaño exacto y pierde el `1fr` del CSS—, así que se virtualiza **por filas**:
 * cada elemento del desplazador es una fila entera, y adentro la fila sigue
 * siendo una rejilla de CSS como antes. Las tarjetas no se tocaron.
 *
 * La cuenta de columnas se hace acá y no se le pregunta al navegador porque ya
 * no hay una rejilla entera que medir: es la misma cuenta que hace
 * `auto-fill minmax(min, 1fr)`, y como también es la que se le escribe a la
 * fila, no hay dos fuentes que puedan discrepar.
 */
interface FormaDeSeccion {
	/** El ancho mínimo de tarjeta que pedía el `minmax()`. */
	minimo: number;
	/** Alto de la tarjeta; la fila mide esto más la separación. */
	altoTarjeta: number;
}

const FORMA: Record<keyof GroupedEntries, FormaDeSeccion> = {
	dirs: { minimo: 180, altoTarjeta: 72 },
	images: { minimo: 170, altoTarjeta: 120 },
	videos: { minimo: 170, altoTarjeta: 120 },
	others: { minimo: 170, altoTarjeta: 120 },
};

type Clave = keyof GroupedEntries;

const CLAVES: Clave[] = ['dirs', 'images', 'videos', 'others'];

const contenedores = ref<Record<Clave, HTMLElement | null>>({
	dirs: null,
	images: null,
	videos: null,
	others: null,
});

const anchos = ref<Record<Clave, number>>({ dirs: 0, images: 0, videos: 0, others: 0 });

function setContenedor(clave: Clave, element: Element | null) {
	contenedores.value[clave] = element instanceof HTMLElement ? element : null;
}

function medirAnchos() {
	for (const clave of CLAVES) {
		anchos.value[clave] = contenedores.value[clave]?.clientWidth ?? 0;
	}
}

function columnasDe(clave: Clave): number {
	return columnasQueEntran(anchos.value[clave], FORMA[clave].minimo);
}

const columnas = computed<Record<Clave, number>>(() => ({
	dirs: columnasDe('dirs'),
	images: columnasDe('images'),
	videos: columnasDe('videos'),
	others: columnasDe('others'),
}));

const filas = computed<Record<Clave, Fila[]>>(() => ({
	dirs: enFilas(groupedEntries.value.dirs, columnas.value.dirs),
	images: enFilas(groupedEntries.value.images, columnas.value.images),
	videos: enFilas(groupedEntries.value.videos, columnas.value.videos),
	others: enFilas(groupedEntries.value.others, columnas.value.others),
}));

function altoDeFila(clave: Clave): number {
	return FORMA[clave].altoTarjeta + SEPARACION_PX;
}

function estiloDeFila(clave: Clave) {
	return { gridTemplateColumns: `repeat(${columnas.value[clave]}, minmax(0, 1fr))` };
}

/** Los desplazadores, para poder llevar la vista a una fila sin dibujar. */
const desplazadores = ref<Record<Clave, { scrollToItem: (indice: number) => void } | null>>({
	dirs: null,
	images: null,
	videos: null,
	others: null,
});

function setDesplazador(clave: Clave, instancia: unknown) {
	desplazadores.value[clave] =
		(instancia as { scrollToItem: (indice: number) => void } | null) ?? null;
}

let observador: ResizeObserver | null = null;

function vigilarContenedores() {
	if (!observador) return;

	observador.disconnect();

	for (const clave of CLAVES) {
		const element = contenedores.value[clave];
		if (element) observador.observe(element);
	}
}

onMounted(() => {
	medirAnchos();

	if (typeof ResizeObserver !== 'undefined') {
		observador = new ResizeObserver(() => medirAnchos());
		vigilarContenedores();
	}
});

// Cambiar de directorio cambia qué secciones existen, y una sección que
// aparece es un contenedor nuevo que hay que medir y vigilar.
watch(groupedEntries, async () => {
	await nextTick();
	vigilarContenedores();
	medirAnchos();
});

onBeforeUnmount(() => {
	observador?.disconnect();
	observador = null;
});

watchEffect(() => {
	ctx.registrarSeccionesVisuales(
		CLAVES.map((clave) => ({
			entradas: groupedEntries.value[clave],
			columnas: columnas.value[clave],
		}))
	);
});

watchEffect(() => {
	ctx.registrarDesplazamiento((path: string) => {
		for (const clave of CLAVES) {
			const indice = filas.value[clave].findIndex((fila) =>
				fila.entradas.some((entrada) => entrada.path === path)
			);

			if (indice !== -1) {
				desplazadores.value[clave]?.scrollToItem(indice);
				return true;
			}
		}

		return false;
	});
});
</script>

<template>
  <!-- El alto fijo es lo que hace que esto se pueda desplazar, y por eso vuelve:
       toda la cadena de arriba resuelve su alto con `h-full`, así que sin un
       tope acá el `ScrollArea` crece hasta el alto del contenido y deja de
       tener algo que desplazar — medido: el viewport pasaba a 448.835 px de
       alto y su `scrollHeight` era el mismo número. Las filas desbordan este
       alto, y eso es lo que el `ScrollArea` desplaza. -->
  <div :key="ctx.currentPath.value" class="flex flex-col p-2 pr-4 gap-3 animate-in fade-in duration-200 h-[calc(100vh-144px)]">
    <template v-if="groupedEntries.dirs.length > 0">
      <div class="sticky z-5 top-0 flex items-center py-2 px-3 rounded-corner backdrop-blur bg-ui-surface text-tx-muted text-xs font-medium gap-2 uppercase">
        <img :src="folderIcon" class="w-4 h-4" />
        <span>{{ t('fileBrowser.folders') }}</span>
        <span class="py-0.5 px-2 rounded-corner bg-ui-bg/80 text-[11px]">{{ groupedEntries.dirs.length }}</span>
      </div>
      <div :ref="(el) => setContenedor('dirs', el as Element | null)">
        <RecycleScroller
          :ref="(el) => setDesplazador('dirs', el)"
          :items="filas.dirs"
          :item-size="altoDeFila('dirs')"
          key-field="clave"
          page-mode
          v-slot="{ item: fila }"
        >
        <div class="grid gap-3" :style="estiloDeFila('dirs')">
        <button v-for="entry in fila.entradas" :key="entry.path"
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
        </RecycleScroller>
      </div>
    </template>

    <template v-if="groupedEntries.images.length > 0">
      <div class="sticky z-5 top-0 flex items-center py-2 px-3 rounded-corner backdrop-blur bg-ui-surface text-tx-muted text-xs font-medium gap-2 uppercase">
        <img :src="fileImageIcon" class="w-4 h-4" />
        <span>{{ t('fileBrowser.images') }}</span>
        <span class="py-0.5 px-2 rounded-[10px] bg-ui-bg/80-3 text-[11px]">{{ groupedEntries.images.length }}</span>
      </div>
      <div :ref="(el) => setContenedor('images', el as Element | null)">
        <RecycleScroller
          :ref="(el) => setDesplazador('images', el)"
          :items="filas.images"
          :item-size="altoDeFila('images')"
          key-field="clave"
          page-mode
          v-slot="{ item: fila }"
        >
        <div class="grid gap-3" :style="estiloDeFila('images')">
        <button v-for="entry in fila.entradas" :key="entry.path"
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
        </RecycleScroller>
      </div>
    </template>

    <template v-if="groupedEntries.videos.length > 0">
      <div class="sticky z-5 top-0 flex items-center py-2 px-3 rounded-corner backdrop-blur bg-ui-surface text-tx-muted text-xs font-medium gap-2 uppercase">
        <img :src="fileVideoIcon" class="w-4 h-4" />
        <span>{{ t('fileBrowser.videos') }}</span>
        <span class="py-0.5 px-2 rounded-[10px] bg-ui-bg/80-3 text-[11px]">{{ groupedEntries.videos.length }}</span>
      </div>
      <div :ref="(el) => setContenedor('videos', el as Element | null)">
        <RecycleScroller
          :ref="(el) => setDesplazador('videos', el)"
          :items="filas.videos"
          :item-size="altoDeFila('videos')"
          key-field="clave"
          page-mode
          v-slot="{ item: fila }"
        >
        <div class="grid gap-3" :style="estiloDeFila('videos')">
        <button v-for="entry in fila.entradas" :key="entry.path"
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
        </RecycleScroller>
      </div>
    </template>

    <template v-if="groupedEntries.others.length > 0">
      <div class="sticky z-5 top-0 flex items-center py-2 px-3 rounded-corner backdrop-blur bg-ui-surface text-tx-muted text-xs font-medium gap-2 uppercase">
        <img :src="fileIcon" class="w-4 h-4" />
        <span>{{ t('fileBrowser.otherFiles') }}</span>
        <span class="py-0.5 px-2 rounded-[10px] bg-ui-bg/80-3 text-[11px]">{{ groupedEntries.others.length }}</span>
      </div>
      <div :ref="(el) => setContenedor('others', el as Element | null)">
        <RecycleScroller
          :ref="(el) => setDesplazador('others', el)"
          :items="filas.others"
          :item-size="altoDeFila('others')"
          key-field="clave"
          page-mode
          v-slot="{ item: fila }"
        >
        <div class="grid gap-3" :style="estiloDeFila('others')">
        <button v-for="entry in fila.entradas" :key="entry.path"
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
        </RecycleScroller>
      </div>
    </template>
  </div>
</template>
