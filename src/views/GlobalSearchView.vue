<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { EmptyState, ThemeIcon } from '@vasakgroup/vue-libvasak';
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import FileBrowserComponent from '@/components/filebrowser/FileBrowserComponent.vue';
import NumberField from '@/components/ui/number-field/NumberField.vue';
import NumberFieldContent from '@/components/ui/number-field/NumberFieldContent.vue';
import NumberFieldDecrement from '@/components/ui/number-field/NumberFieldDecrement.vue';
import NumberFieldIncrement from '@/components/ui/number-field/NumberFieldIncrement.vue';
import NumberFieldInput from '@/components/ui/number-field/NumberFieldInput.vue';
import { getDriveByPath } from '@/composables/use-drives';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';
import type { DirEntry } from '@/types/dir-entry';
import type { DriveInfo } from '@/types/drive-info';

type FileBrowserInstance = InstanceType<typeof FileBrowserComponent>;

const emit = defineEmits<{
	close: [];
	openEntry: [entry: DirEntry];
	'update:selectedEntries': [entries: DirEntry[]];
}>();

const { t, locale } = useI18n();

const globalSearchStore = useGlobalSearchStore();
const inputRef = ref<HTMLInputElement | null>(null);
const showOptions = ref(false);

const includeFiles = ref(true);
const includeDirectories = ref(true);
const resultLimit = ref(500);
const exactMatch = ref(false);
const typoTolerance = ref(true);
const scanDepth = ref(6);

function toggleOptions() {
	showOptions.value = !showOptions.value;
}

const collapsedDrives = ref<Set<string>>(new Set());

const hasIndexData = computed(() => globalSearchStore.indexedItemCount > 0);

/**
 * Si hay que avisar que el índice se está armando ahora mismo.
 *
 * Acá había una barra de progreso con la unidad en curso y un «3 de 5». Se fue
 * con el recorrido: quien indexa es `vasak-prism` y esta aplicación se entera
 * por un archivo, así que **el progreso no se sabe**. Dibujar una barra que
 * avanza sin saber cuánto falta sería inventarlo.
 *
 * Lo que sí es cierto y sirve: que hay uno corriendo, para que quien busque
 * entienda por qué aparecen resultados nuevos entre una búsqueda y la
 * siguiente.
 */
const indizandoAhora = computed(() => globalSearchStore.isScanInProgress);

/**
 * Que todavía no hay índice, que **no es un error**.
 *
 * Va separado del fallo de abrirlo y se dibuja distinto. Con los dos juntos
 * pasaban las dos cosas malas a la vez: la primera búsqueda en una máquina
 * recién instalada salía en rojo por algo que no está roto, y un índice que de
 * verdad no se puede abrir salía con el texto «abrí el lanzador», que no lo
 * arregla.
 */
const faltaElIndice = computed(() => globalSearchStore.indexMissing);

/** Y esto sí es un problema: hay índice y no se pudo abrir. */
const sinIndice = computed(() => globalSearchStore.indexUnavailableReason);

/**
 * Cuánto hace que se indexó, en palabras.
 *
 * Estaba escrito en inglés a mano —«2 minutes ago», con la `s` del plural
 * puesta con un ternario—, así que en español decía eso mismo. Ahora sale del
 * archivo de traducciones, con la clave según la cantidad para que no diga
 * «hace 1 minutos».
 *
 * Más de una semana se muestra como fecha, que es lo que se entiende mejor a
 * esa distancia, y va en el idioma de la interfaz y no en el del sistema.
 */
function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return t('globalSearch.relativeTime.justNow');
	if (minutes < 60) {
		return interpolar(t(claveSegunCantidad('globalSearch.relativeTime.minutes', minutes)), minutes);
	}
	if (hours < 24) {
		return interpolar(t(claveSegunCantidad('globalSearch.relativeTime.hours', hours)), hours);
	}
	if (days < 7) {
		return interpolar(t(claveSegunCantidad('globalSearch.relativeTime.days', days)), days);
	}

	return new Date(timestamp).toLocaleDateString(locale.value);
}

const lastScanRelative = computed(() => {
	if (!globalSearchStore.lastScanTime) return null;
	return formatRelativeTime(globalSearchStore.lastScanTime);
});

type GroupedResults = {
	driveRoot: string;
	driveInfo: DriveInfo | null;
	entries: DirEntry[];
};

function getDriveRoot(path: string): string {
	if (/^[a-zA-Z]:/.test(path)) {
		return `${path.substring(0, 2).toUpperCase()}/`;
	}

	const parts = path.split('/').filter(Boolean);

	if (parts.length > 0) {
		return `/${parts[0]}`;
	}

	return '/';
}

const filteredResults = computed(() => {
	return globalSearchStore.results.filter((entry) => {
		if (entry.is_file && !includeFiles.value) return false;
		if (entry.is_dir && !includeDirectories.value) return false;
		return true;
	});
});

const groupedResults = computed<GroupedResults[]>(() => {
	const groups = new Map<string, DirEntry[]>();

	for (const entry of filteredResults.value) {
		const driveRoot = getDriveRoot(entry.path);
		const existing = groups.get(driveRoot);

		if (existing) {
			existing.push(entry);
		} else {
			groups.set(driveRoot, [entry]);
		}
	}

	return Array.from(groups.entries())
		.sort(([driveRootA], [driveRootB]) => driveRootA.localeCompare(driveRootB))
		.map(([driveRoot, entries]) => ({
			driveRoot,
			driveInfo: getDriveByPath(driveRoot),
			entries,
		}));
});

const totalResultsCount = computed(() => filteredResults.value.length);

watch([exactMatch, typoTolerance, resultLimit], () => {
	if (globalSearchStore.query.trim()) {
		globalSearchStore.search();
	}
});

function toggleDriveCollapse(driveRoot: string) {
	if (collapsedDrives.value.has(driveRoot)) {
		collapsedDrives.value.delete(driveRoot);
	} else {
		collapsedDrives.value.add(driveRoot);
	}
}

function isDriveCollapsed(driveRoot: string): boolean {
	return collapsedDrives.value.has(driveRoot);
}

function getEntryDescription(entry: DirEntry): string | undefined {
	return entry.path;
}

const searchFileBrowserRefs = ref<Map<string, FileBrowserInstance>>(new Map());
const activeSearchDriveRoot = ref<string | null>(null);

function setSearchFileBrowserRef(element: FileBrowserInstance | null, driveRoot: string) {
	if (element) {
		searchFileBrowserRefs.value.set(driveRoot, element);
	} else {
		searchFileBrowserRefs.value.delete(driveRoot);
	}
}

function handleSearchSelectionChange(entries: DirEntry[], driveRoot: string) {
	if (entries.length > 0) {
		activeSearchDriveRoot.value = driveRoot;

		searchFileBrowserRefs.value.forEach((fileBrowser, key) => {
			if (key !== driveRoot) {
				fileBrowser.clearSelection();
			}
		});

		emit('update:selectedEntries', entries);
	} else if (driveRoot === activeSearchDriveRoot.value) {
		activeSearchDriveRoot.value = null;
		emit('update:selectedEntries', []);
	}
}

function getActiveFileBrowser(): FileBrowserInstance | undefined {
	if (activeSearchDriveRoot.value) {
		return searchFileBrowserRefs.value.get(activeSearchDriveRoot.value);
	}

	return undefined;
}

function clearSelections() {
	searchFileBrowserRefs.value.forEach((fileBrowser) => {
		fileBrowser.clearSelection();
	});
	activeSearchDriveRoot.value = null;
}

defineExpose({
	getActiveFileBrowser,
	clearSelections,
});

function handleSearchEntryOpen(entry: DirEntry) {
	emit('openEntry', entry);
}

function handleClose() {
	emit('close');
}

function clearQuery() {
	globalSearchStore.clearQuery();
	inputRef.value?.focus();
}

function focusInput() {
	setTimeout(() => {
		inputRef.value?.focus();
	}, 0);
}

watch(
	() => globalSearchStore.isOpen,
	async (isOpen) => {
		if (isOpen) {
			await globalSearchStore.refreshStatus();
			globalSearchStore.startStatusPolling();
			focusInput();
		}
	},
	{ immediate: true }
);

onActivated(async () => {
	if (globalSearchStore.isOpen) {
		await globalSearchStore.refreshStatus();
		globalSearchStore.startStatusPolling();
	}
});

onMounted(async () => {
	focusInput();
});
</script>

<template>
  <div class="flex h-full flex-col border border-dashed border-ui-border [--results-header-height:36px] [--search-scroll-gutter:18px]">
    <div class="flex items-center gap-3 p-2 pb-0">
      <div class="relative flex flex-1 items-center">
        <ThemeIcon
          v-if="!globalSearchStore.isSearching"
          name="search"
          type="symbol"
          :size="16"
          class="pointer-events-none absolute left-3 text-tx-muted" />
        <ThemeIcon
          v-else
          name="content-loading-symbolic"
          type="symbol"
          :size="16"
          class="pointer-events-none absolute left-3 text-tx-muted animate-spin" />
        <input
          ref="inputRef"
          :value="globalSearchStore.query"
          :placeholder="t('globalSearch.globalSearch')"
          class="flex-1 pl-10 pr-10"
          :disabled="!hasIndexData && !indizandoAhora"
          @input="globalSearchStore.setQuery(String(($event.target as HTMLInputElement).value ?? ''))"
        />
        <button v-if="globalSearchStore.query" class="absolute right-1 h-8 w-8"
          @click="clearQuery">
          <ThemeIcon name="gtk-close" type="symbol" :size="16" />
        </button>
      </div>
      <div class="flex items-center gap-1">
        <button class="text-tx-muted data-[active]:bg-primary/10 data-[active]:text-primary"
          :data-active="showOptions || undefined" @click="toggleOptions">
          <ThemeIcon name="dialog-filters" type="symbol" :size="16" />
        </button>
        <button @click="handleClose">
          <ThemeIcon name="gtk-close" type="symbol" :size="16" />
        </button>
      </div>
    </div>

    <!-- Todavía no hay índice, que es un estado y no una falla.
         En tono informativo a propósito: el rojo es para lo que está roto, y
         acá no hay nada roto — el lanzador todavía no escaneó. Lo que sí hace
         falta es nombrarlo, porque es la única acción posible y no se puede
         adivinar desde esta aplicación. -->
    <div v-if="faltaElIndice"
      class="mx-2 mt-2 flex flex-col gap-0.5 rounded-corner bg-ui-surface/70 px-3 py-2 text-[13px] text-tx-main">
      <span class="font-medium">{{ t('globalSearch.noIndexYet') }}</span>
      <span class="text-tx-muted">{{ t('globalSearch.noIndexYetDescription') }}</span>
    </div>

    <!-- Lo que falló, dicho.
         `lastError` existía desde siempre, se escribía en trece lugares y **no
         lo leía nadie**: cuando algo se rompía, el panel se quedaba con el
         cartel de «todavía no hay índice» y no había forma de enterarse.
         El título va traducido y el detalle no: es lo que contesta el backend,
         y es preferible mostrarlo tal cual —sirve para un informe de error— a
         tragárselo.
         El motivo de no poder abrir el índice va acá y no con `lastError`: el
         comando de estado **sale bien** aunque el índice no se pueda abrir, así
         que su casillero de error se limpia y ahí no llegaría nunca. -->
    <div v-if="globalSearchStore.lastError || sinIndice"
      class="mx-2 mt-2 flex flex-col gap-0.5 rounded-corner bg-status-error/10 px-3 py-2 text-[13px] text-status-error">
      <span class="font-medium">{{ t('globalSearch.somethingFailed') }}</span>
      <span v-if="sinIndice" class="break-words text-status-error/80">{{ sinIndice }}</span>
      <span v-if="globalSearchStore.lastError" class="break-words text-status-error/80">{{
        globalSearchStore.lastError }}</span>
    </div>

    <div v-if="showOptions" class="mx-1 mb-4 flex gap-6 rounded-corner-sm border-b border-ui-border bg-ui-surface/30 px-4 py-3">
      <div class="flex flex-col gap-2">
        <span class="text-[11px] font-medium uppercase text-tx-muted">{{ t('globalSearch.results') }}</span>
        <div class="flex items-center gap-2">
          <input
            id="include-files"
            v-model="includeFiles"
            type="checkbox"
          />
          <label for="include-files" class="cursor-pointer text-[13px] font-normal">
            {{ t('globalSearch.showFiles') }}
          </label>
        </div>
        <div class="flex items-center gap-2">
          <input
            id="include-directories"
            v-model="includeDirectories"
            type="checkbox"
          />
          <label for="include-directories" class="cursor-pointer text-[13px] font-normal">
            {{ t('globalSearch.showDirectories') }}
          </label>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-[11px] font-medium uppercase text-tx-muted">{{ t('globalSearch.options') }}</span>
        <div class="flex items-center gap-2">
          <input
            id="exact-match"
            v-model="exactMatch"
            type="checkbox"
          />
          <label for="exact-match" class="cursor-pointer text-[13px] font-normal">
            {{ t('globalSearch.exactMatch') }}
          </label>
        </div>
        <div class="flex items-center gap-2">
          <input
            id="typo-tolerance"
            v-model="typoTolerance"
            type="checkbox"
          />
          <label for="typo-tolerance" class="cursor-pointer text-[13px] font-normal">
            {{ t('globalSearch.typoTolerance') }}
          </label>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-[11px] font-medium uppercase text-tx-muted">{{ t('globalSearch.resultLimit') }}</span>
        <NumberField :model-value="resultLimit" class="w-[120px]" :min="10" :max="500"
          :step="10">
          <NumberFieldContent>
            <NumberFieldDecrement />
            <NumberFieldInput />
            <NumberFieldIncrement />
          </NumberFieldContent>
        </NumberField>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col px-2 pr-0">
      <!-- Un aviso, no una barra. Ver `indizandoAhora`. -->
      <div v-if="indizandoAhora" class="flex flex-col gap-2 bg-primary/5 px-4 py-3">
        <div class="flex flex-wrap items-center gap-2 text-[13px]">
          <span class="text-tx-muted">{{ t('globalSearch.launcherIsIndexing') }}</span>
        </div>
        <div class="text-xs text-tx-muted">
          {{ interpolar(
            t(claveSegunCantidad('globalSearch.indexedItems', globalSearchStore.indexedItemCount)),
            globalSearchStore.indexedItemCount.toLocaleString(locale)
          ) }}
        </div>
      </div>

      <!-- Sin esto, «0 elementos indexados» se lee como un hecho cuando puede
           ser un síntoma: el escaneo se canceló, falló, o murió a mitad. -->
      <div v-if="globalSearchStore.indiceIncompleto"
        class="bg-ui-surface/70 px-4 py-2 text-xs text-tx-muted">
        {{ t('globalSearch.indexMayBeIncomplete') }}
      </div>

      <div v-if="globalSearchStore.results.length > 0"
        class="h-[var(--results-header-height)] bg-transparent px-0.5 text-xs font-medium leading-[var(--results-header-height)] text-tx-muted">
        {{ interpolar(t('globalSearch.searchStats.foundOnDrives'), totalResultsCount, groupedResults.length) }}
      </div>

      <div class="flex-1 overflow-y-auto">
        <div class="flex min-h-full flex-col gap-0.5 pr-[var(--search-scroll-gutter)]">
          <!-- La condición es «el índice está vacío y nadie lo está armando».
               El texto decía «Datos de búsqueda incompletos · Sin unidades
               seleccionadas», que es de cuando se elegían unidades a mano —eso
               está comentado en el store desde hace rato y hoy se recorren
               todas—. O sea que nombraba una causa que no existe y dejaba sin
               nombrar la que sí: todavía no hay índice. De paso lo dice el
               campo de arriba, que está apagado con esta misma condición. -->
          <EmptyState v-if="!hasIndexData && !indizandoAhora"
            icon="search" icon-type="symbol" :title="t('globalSearch.indexEmpty')"
            :note="t('globalSearch.indexEmptyDescription')" />

          <div v-else-if="!globalSearchStore.query.trim()" class="flex flex-col items-center justify-center gap-3 px-6 py-16">
            <ThemeIcon name="search" type="symbol" :size="48" class="text-tx-muted/30" />
            <span class="text-base font-medium text-tx-main">
              {{ t('globalSearch.globalSearch') }}
            </span>
            <span class="text-[13px] text-tx-muted">
              {{ interpolar(
                t(claveSegunCantidad('globalSearch.searchStats.searched', globalSearchStore.indexedItemCount)),
                globalSearchStore.indexedItemCount.toLocaleString(locale)
              ) }}
              ({{ interpolar(
                t(claveSegunCantidad('globalSearch.searchStats.searchingLevelsDeep', scanDepth)),
                scanDepth
              ) }}<template v-if="lastScanRelative">, {{
                interpolar(t('globalSearch.searchStats.indexed'), lastScanRelative)
              }}</template>)
            </span>
            <!-- Acá iba un botón «mostrar ajustes de búsqueda». Su manejador
                 era una función vacía —cuerpo `{}`—, así que apretarlo no
                 hacía nada. Y no es que faltara conectarlo —no
                 hay ninguna pantalla de ajustes de la búsqueda, ni en esta
                 aplicación ni en vasak-settings—: lo que habría que ajustar
                 —la profundidad del recorrido, las rutas ignoradas, el
                 recorrido en paralelo, las unidades elegidas— está **comentado**
                 en el store y hoy son valores fijos. Un botón que ofrece algo
                 que no existe en ningún lado es peor que no tenerlo. -->
          </div>

          <EmptyState v-else-if="globalSearchStore.results.length === 0 && !globalSearchStore.isSearching"
            icon="search" icon-type="symbol" :title="t('globalSearch.searchStats.nothingFound')" />

          <template v-else-if="globalSearchStore.results.length > 0">
            <div v-for="group in groupedResults" :key="group.driveRoot">
              <button
                class="sticky top-0 z-5 flex w-full items-center gap-2.5 rounded-corner-sm bg-background-2 px-4 py-3 text-left text-[13px] font-medium text-tx-main focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
                @click="toggleDriveCollapse(group.driveRoot)">
                <div class="h-4 w-4 shrink-0 rounded-full bg-primary/40" />
                <span class="flex-1 font-mono">
                  {{ group.driveInfo?.name || group.driveRoot }}
                </span>
                <span class="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-tx-muted">
                  {{ interpolar(
                    t(claveSegunCantidad('fileBrowser.itemCount', group.entries.length)),
                    group.entries.length
                  ) }}
                </span>
                <ThemeIcon
                  name="arrow-down"
                  type="symbol"
                  :size="16"
                  class="shrink-0 text-tx-muted transition-transform duration-150 ease-out"
                  :class="{ '-rotate-90': isDriveCollapsed(group.driveRoot) }" />
              </button>

              <div v-if="!isDriveCollapsed(group.driveRoot)"
                class="flex flex-col [--file-browser-list-columns:minmax(120px,_1fr)_minmax(50px,_100px)_minmax(60px,_140px)] [&_.file-browser__content]:[--file-browser-list-right-gutter:0]">
                <FileBrowserComponent
                  :ref="(element: any) => setSearchFileBrowserRef(element as FileBrowserInstance, group.driveRoot)"
                  :external-entries="group.entries" :base-path="group.driveRoot" layout="list" :hide-toolbar="true"
                  :hide-status-bar="true" :entry-description="getEntryDescription" @open-entry="handleSearchEntryOpen"
                  @update:selected-entries="(entries: DirEntry[]) => handleSearchSelectionChange(entries, group.driveRoot)" />
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>