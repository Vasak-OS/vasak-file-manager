<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import FileBrowserComponent from '@/components/filebrowser/FileBrowserComponent.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import NumberField from '@/components/ui/number-field/NumberField.vue';
import NumberFieldContent from '@/components/ui/number-field/NumberFieldContent.vue';
import NumberFieldDecrement from '@/components/ui/number-field/NumberFieldDecrement.vue';
import NumberFieldIncrement from '@/components/ui/number-field/NumberFieldIncrement.vue';
import NumberFieldInput from '@/components/ui/number-field/NumberFieldInput.vue';
import { getDriveByPath } from '@/composables/use-drives';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import type { DirEntry } from '@/types/dir-entry';
import type { DriveInfo } from '@/types/drive-info';
import { getSymbolSource } from '@vasakgroup/plugin-vicons';

type FileBrowserInstance = InstanceType<typeof FileBrowserComponent>;

const emit = defineEmits<{
	close: [];
	openEntry: [entry: DirEntry];
	'update:selectedEntries': [entries: DirEntry[]];
}>();

const { t } = useI18n();

const globalSearchStore = useGlobalSearchStore();
const inputRef = ref<HTMLInputElement | null>(null);
const showOptions = ref(false);

const includeFiles = ref(true);
const includeDirectories = ref(true);
const resultLimit = ref(500);
const exactMatch = ref(false);
const typoTolerance = ref(true);
const scanDepth = ref(6);

const searchIcon = ref('');
const settingsIcon = ref('');
const chevronDownIcon = ref('');
const xIcon = ref('');
const loaderIcon = ref('');
const slidersHorizontalIcon = ref('');

function openSearchSettings() {}

function toggleOptions() {
	showOptions.value = !showOptions.value;
}

const collapsedDrives = ref<Set<string>>(new Set());

const hasIndexData = computed(() => globalSearchStore.indexedItemCount > 0);
const showScanProgress = computed(
	() =>
		(globalSearchStore.isScanInProgress || globalSearchStore.isCommitting) &&
		globalSearchStore.totalDrivesCount > 0
);
const isCommitting = computed(() => globalSearchStore.isCommitting);

function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return 'Just now';
	if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
	if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
	if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;

	return new Date(timestamp).toLocaleDateString();
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

onMounted(async() => {
	focusInput();
  searchIcon.value = await getSymbolSource('search');
  settingsIcon.value = await getSymbolSource('settings-configure');
  chevronDownIcon.value = await getSymbolSource('arrow-down');
  xIcon.value = await getSymbolSource('gtk-close');
  loaderIcon.value = await getSymbolSource('content-loading-symbolic');
  slidersHorizontalIcon.value = await getSymbolSource('dialog-filters');
});
</script>

<template>
  <div class="flex h-full flex-col border border-dashed border-border [--results-header-height:36px] [--search-scroll-gutter:18px]">
    <div class="flex items-center gap-3 p-2 pb-0">
      <div class="relative flex flex-1 items-center">
        <img :src="searchIcon" v-if="!globalSearchStore.isSearching" class="h-4 w-4 pointer-events-none absolute left-3 text-muted-foreground" />
        <img :src="loaderIcon" v-else 
          class="pointer-events-none absolute left-3 text-muted-foreground animate-spin h-4 w-4" />
        <input
          ref="inputRef"
          :value="globalSearchStore.query"
          :placeholder="'globalSearch.globalSearch'"
          class="flex-1 pl-10 pr-10"
          :disabled="!hasIndexData && !globalSearchStore.isScanInProgress && !globalSearchStore.isCommitting"
          @input="globalSearchStore.setQuery(String(($event.target as HTMLInputElement).value ?? ''))"
        />
        <button v-if="globalSearchStore.query" variant="ghost" size="icon" class="absolute right-1 h-8 w-8"
          @click="clearQuery">
          <img :src="xIcon" class="h-4 w-4" />
        </button>
      </div>
      <div class="flex items-center gap-1">
        <button variant="ghost" size="icon" class="text-muted-foreground data-[active]:bg-primary/10 data-[active]:text-primary"
          :data-active="showOptions || undefined" @click="toggleOptions">
          <img :src="slidersHorizontalIcon" class="h-4 w-4" />
        </button>
        <button variant="outline" size="icon" @click="handleClose">
          <img :src="xIcon" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div v-if="showOptions" class="mx-1 mb-4 flex gap-6 rounded-sm border-b border-border bg-muted/30 px-4 py-3">
      <div class="flex flex-col gap-2">
        <span class="text-[11px] font-medium uppercase text-muted-foreground">{{ t('globalSearch.results') }}</span>
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
        <span class="text-[11px] font-medium uppercase text-muted-foreground">{{ t('globalSearch.options') }}</span>
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
        <span class="text-[11px] font-medium uppercase text-muted-foreground">{{ t('globalSearch.resultLimit') }}</span>
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
      <div v-if="showScanProgress" class="flex flex-col gap-2 bg-primary/5 px-4 py-3">
        <div class="flex flex-wrap items-center gap-2 text-[13px]">
          <span class="text-muted-foreground">
            {{ isCommitting ? 'globalSearch.indexStatus.committing' : (globalSearchStore.isParallelScan ?
              'globalSearch.scanningInParallel' : 'globalSearch.driveScanInProgress') }}
          </span>
          <span v-if="globalSearchStore.currentDriveRoot && !isCommitting && !globalSearchStore.isParallelScan"
            class="rounded-sm bg-primary/15 px-2 py-0.5 font-mono text-xs font-medium text-primary">
            {{ globalSearchStore.currentDriveRoot }}
          </span>
          <span v-if="!isCommitting" class="ml-auto text-xs text-muted-foreground">
            {{ globalSearchStore.scannedDrivesCount }} / {{ globalSearchStore.totalDrivesCount }}
          </span>
        </div>
        <div class="relative h-1 overflow-hidden rounded-full bg-secondary">
          <div class="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
            :style="{ width: isCommitting ? '100%' : `${globalSearchStore.scanProgress}%` }" />
        </div>
        <div class="text-xs text-muted-foreground">
          {{ `globalSearch.indexedItems, ${globalSearchStore.indexedItemCount.toLocaleString()}` }}
        </div>
      </div>

      <div v-if="globalSearchStore.results.length > 0"
        class="h-[var(--results-header-height)] bg-transparent px-0.5 text-xs font-medium leading-[var(--results-header-height)] text-muted-foreground">
        {{ `globalSearch.searchStats.foundOnDrives, ${totalResultsCount}, ${groupedResults.length}` }}
      </div>

      <div class="flex-1 overflow-y-auto">
        <div class="flex min-h-full flex-col gap-0.5 pr-[var(--search-scroll-gutter)]">
          <EmptyState v-if="!hasIndexData && !globalSearchStore.isScanInProgress && !globalSearchStore.isCommitting"
            :icon="searchIcon" :title="t('globalSearch.searchDataIncomplete')"
            :description="t('globalSearch.noDrivesSelected')" :bordered="false" />

          <div v-else-if="!globalSearchStore.query.trim()" class="flex flex-col items-center justify-center gap-3 px-6 py-16">
            <img :src="searchIcon" :size="48" class="text-muted-foreground/30" />
            <span class="text-base font-medium text-foreground">
              {{ t('globalSearch.globalSearch') }}
            </span>
            <span class="text-[13px] text-muted-foreground">
              {{ `globalSearch.searchStats.searched', ${ globalSearchStore.indexedItemCount.toLocaleString() }` }}
              ({{ `globalSearch.searchStats.searchingLevelsDeep, ${ scanDepth }` }}<template
                v-if="lastScanRelative">, {{ `globalSearch.searchStats.indexed, ${
                  lastScanRelative
                }`.toLowerCase() }}</template>)
            </span>
            <button variant="outline" size="sm" class="mt-2 gap-1.5" @click="openSearchSettings">
              <img :src="settingsIcon" class="h-4 w-4" />
              {{ t('globalSearch.showSearchSettings') }}
            </button>
          </div>

          <EmptyState v-else-if="globalSearchStore.results.length === 0 && !globalSearchStore.isSearching"
            :icon="searchIcon" :title="t('globalSearch.searchStats.nothingFound')" :bordered="false" />

          <template v-else-if="globalSearchStore.results.length > 0">
            <div v-for="group in groupedResults" :key="group.driveRoot">
              <button
                class="sticky top-0 z-5 flex w-full items-center gap-2.5 rounded-sm bg-background-2 px-4 py-3 text-left text-[13px] font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
                @click="toggleDriveCollapse(group.driveRoot)">
                <div class="h-4 w-4 shrink-0 rounded-full bg-primary/40" />
                <span class="flex-1 font-mono">
                  {{ group.driveInfo?.name || group.driveRoot }}
                </span>
                <span class="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {{ `item, ${group.entries.length}` }}
                </span>
                <img :src="chevronDownIcon" class="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out"
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