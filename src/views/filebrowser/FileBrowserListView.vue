<script setup lang="ts">
import { getSymbolSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { storeToRefs } from 'pinia';
import { computed, type Ref, ref, watchEffect } from 'vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import { useFileBrowserContext } from '@/composables/file-browser/use-file-browser-context';
import { useReactiveIcon } from '@/composables/useReactiveIcon';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import type { DirEntry } from '@/types/dir-entry';
import { formatBytes } from '@/utils/byte-parser';
import { formatDate } from '@/utils/date-formatter';

const { t } = useI18n();

interface Props {
	entries: DirEntry[];
}

const props = defineProps<Props>();

const ctx = useFileBrowserContext();
const selectedIcon = useReactiveIcon(() => getSymbolSource('object-select-symbolic'));
const loaderCircleIcon = useReactiveIcon(() => getSymbolSource('content-loading-symbolic'));
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

/**
 * El desplazador, para poder llevar la vista a una fila que todavía no está
 * dibujada.
 *
 * Con la lista virtualizada, `scrollIntoView` sobre el elemento no alcanza:
 * cuando la fila está fuera de la ventana no existe en el DOM. Hay que pedirle
 * al desplazador que la ponga a la vista, y recién entonces el elemento aparece
 * y se lo puede enfocar.
 */
/**
 * Se tipa por lo que se usa y no con `InstanceType`: el componente está
 * declarado como una función genérica y `InstanceType` no aplica sobre eso.
 */
const desplazador = ref<{ scrollToItem: (indice: number) => void } | null>(null);

watchEffect(() => {
	ctx.registrarDesplazamiento((path: string) => {
		const indice = props.entries.findIndex((entrada) => entrada.path === path);

		if (indice === -1) return false;

		desplazador.value?.scrollToItem(indice);
		return true;
	});
});

/**
 * Una sola sección, de una sola columna.
 *
 * Se informa aunque sea lo que se asume por omisión: al pasar de la cuadrícula
 * a la lista hay que **reemplazar** las cuatro secciones que dejó la otra
 * vista, o las flechas seguirían moviéndose como si hubiera columnas.
 */
watchEffect(() => {
	ctx.registrarSeccionesVisuales([{ entradas: props.entries, columnas: 1 }]);
});

function handleEntryKeydown(event: KeyboardEvent): void {
	if (event.code === 'Space') {
		event.preventDefault();
	}
}
</script>

<template>
  <!-- El alto fijo es lo que hace que esto se pueda desplazar: toda la cadena
       de arriba resuelve su alto con `h-full`, así que sin un tope acá el
       `ScrollArea` crece hasta el alto del contenido y deja de tener algo que
       desplazar. Las filas desbordan este alto, y eso es lo que se desplaza. -->
  <div class="flex flex-col h-[calc(100vh-210px)]" style="padding-right: var(--file-browser-list-right-gutter);">
    <!-- Iba un `page-mode` acá, para que desplazara el `ScrollArea` que
         envuelve a la vista y no el desplazador. En esta versión de
         `vue-virtual-scroller` `DynamicScroller` no declara esa propiedad
         —sólo `RecycleScroller`— y encima lleva `inheritAttrs: false`, así que
         el atributo no llegaba a ningún lado: el desplazador siempre trabajó
         con su propio `overflow`, que es de dónde sale el alto fijo de acá
         arriba. Se saca porque no hacía nada; que el `ScrollArea` vuelva a ser
         el único que desplaza es otro cambio, con su propia prueba a ojo. -->
    <DynamicScroller
      :key="ctx.currentPath.value"
      ref="desplazador"
      :items="props.entries"
      :min-item-size="44"
      key-field="path"
      class="flex flex-col"
      v-slot="{ item: entry, active }"
    >
      <!-- El `:data-index="index"` que traía el ejemplo de la librería no lo
           leía nadie —ni el CSS, ni un `querySelector`, ni una prueba—, y
           `DynamicScrollerItem` tampoco lo necesita: su `index` sólo hace
           falta en modo «arreglo simple», y acá las entradas se identifican
           por `key-field="path"`. Era decoración del DOM, y con él se va el
           `index` de la ranura, que ya no usa nadie. -->
      <DynamicScrollerItem
        :item="entry"
        :active="active"
        :size-dependencies="[entry.name, ctx.entryDescription?.(entry)]"
      >
      <button :key="entry.path" class="relative grid border-b border-ui-border text-left hover:bg-ui-bg/80 group focus-visible:outline-none data-[drag-over]:bg-primary/5 w-full" :class="{
        'opacity-50': entry.is_hidden,
      }" :data-entry-path="entry.path" :data-selected="ctx.isEntrySelected(entry) || undefined"
        :data-in-clipboard="clipboardPathsMap.has(entry.path) || undefined"
        :data-clipboard-type="clipboardPathsMap.get(entry.path) || undefined"
        :data-drop-target="entry.is_dir || undefined" @mousedown="ctx.onEntryMouseDown(entry, $event)"
        @mouseup="ctx.onEntryMouseUp(entry, $event)" @contextmenu="ctx.openEntryContextMenu(entry, $event)"
        @keydown="handleEntryKeydown"
        style="grid-template-columns: var(--file-browser-list-columns); padding: var(--file-browser-list-row-padding-y) var(--file-browser-list-row-padding-x);">
        <div class="absolute inset-0 z-0 pointer-events-none">
          <div class="absolute inset-0 pointer-events-none opacity-0 data-[in-clipboard]:data-[clipboard-type='copy']:opacity-100 data-[in-clipboard]:data-[clipboard-type='copy']:bg-status-success/5 data-[in-clipboard]:data-[clipboard-type='copy']:shadow-[inset_0_0_0_1px_hsl(var(--success)/0.3),inset_3px_0_0_0_hsl(var(--success)/0.5)] data-[selected]:data-[in-clipboard]:data-[clipboard-type='copy']:bg-status-success/10 data-[selected]:data-[in-clipboard]:data-[clipboard-type='copy']:shadow-[inset_0_0_0_1px_hsl(var(--success)/0.5),inset_3px_0_0_0_hsl(var(--success)/0.7)] data-[in-clipboard]:data-[clipboard-type='move']:opacity-100 data-[in-clipboard]:data-[clipboard-type='move']:bg-status-warning/5 data-[in-clipboard]:data-[clipboard-type='move']:shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.3),inset_3px_0_0_0_hsl(var(--warning)/0.5)] data-[selected]:data-[in-clipboard]:data-[clipboard-type='move']:bg-status-warning/10 data-[selected]:data-[in-clipboard]:data-[clipboard-type='move']:shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.5),inset_3px_0_0_0_hsl(var(--warning)/0.7)]" />
          <div class="absolute inset-0 pointer-events-none bg-tx-main/5 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-hover:duration-0 group-data-[drag-over]:bg-primary/15 group-data-[drag-over]:shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.6)] group-data-[drag-over]:opacity-100 group-data-[drag-over]:duration-0" />
        </div>
        <div class="relative z-10 flex overflow-hidden items-center pr-4 gap-2.5 group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
          <img v-if="ctx.isEntrySelected(entry)" :src="selectedIcon" :alt="t('fileBrowser.selected')" class="h-4 w-4" />
          <EntryIconComponent :entry="entry" class="h-4 w-4 shrink-0 text-tx-muted" :class="{'text-primary': entry.is_dir}" />
          <div class="flex overflow-hidden min-w-0 flex-1 flex-col gap-0.5">
            <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ entry.name }}</span>
            <span v-if="ctx.entryDescription?.(entry)" class="overflow-hidden text-tx-muted text-[11px] text-ellipsis whitespace-nowrap">{{
              ctx.entryDescription!(entry) }}</span>
          </div>
        </div>
        <span v-if="showItemsColumn" class="relative z-10 overflow-hidden pr-[var(--file-browser-list-cell-padding-right)] text-tx-muted text-xs text-ellipsis whitespace-nowrap group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
          {{ getItemsDisplay(entry) }}
        </span>
        <span v-if="showSizeColumn" class="relative z-10 flex items-center gap-1.5 overflow-hidden pr-[var(--file-browser-list-cell-padding-right)] text-tx-muted text-xs text-ellipsis whitespace-nowrap group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
          <img :src="loaderCircleIcon" :alt="t('operations.calculatingSize')" v-if="isDirLoadingWithProgress(entry)" class="shrink-0 animate-spin text-tx-muted" />
          <Skeleton v-if="getSizeDisplay(entry) === null" class="w-[50px] h-3" />
          <template v-else>{{ getSizeDisplay(entry) }}</template>
        </span>
        <span v-if="showModifiedColumn" class="relative z-10 overflow-hidden pr-[var(--file-browser-list-cell-padding-right)] text-tx-muted text-xs text-ellipsis whitespace-nowrap group-data-[selected]:group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning group-data-[in-clipboard]:group-data-[clipboard-type='copy']:text-status-success group-data-[in-clipboard]:group-data-[clipboard-type='move']:text-status-warning">
          {{ formatDate(entry.modified_time) }}
        </span>
      </button>
      </DynamicScrollerItem>
    </DynamicScroller>
  </div>
</template>
