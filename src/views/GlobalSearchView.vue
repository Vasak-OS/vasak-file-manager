<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue';
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

type FileBrowserInstance = InstanceType<typeof FileBrowserComponent>;

const emit = defineEmits<{
	close: [];
	openEntry: [entry: DirEntry];
	'update:selectedEntries': [entries: DirEntry[]];
}>();

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
//  function openSearchSettings() {
//  	settingsStore.setCurrentTab('search');
//  	router.push({ name: 'settings' });
//  }

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

onMounted(() => {
	focusInput();
});
</script>

<template>
  <div class="global-search-view">
    <div class="global-search-view__header">
      <div class="global-search-view__search-container">
        <SearchIcon v-if="!globalSearchStore.isSearching" :size="18" class="global-search-view__search-icon" />
        <LoaderCircleIcon v-else :size="18"
          class="global-search-view__search-icon global-search-view__search-icon--loading" />
        <input
          ref="inputRef"
          :value="globalSearchStore.query"
          :placeholder="'globalSearch.globalSearch'"
          class="global-search-view__input"
          :disabled="!hasIndexData && !globalSearchStore.isScanInProgress && !globalSearchStore.isCommitting"
          @input="globalSearchStore.setQuery(String(($event.target as HTMLInputElement).value ?? ''))"
        />
        <button v-if="globalSearchStore.query" variant="ghost" size="icon" class="global-search-view__clear-button"
          @click="clearQuery">
          <img :src="xIcon" :size="16" />
        </button>
      </div>
      <div class="global-search-view__header-actions">
        <button variant="ghost" size="icon" class="global-search-view__options-toggle"
          :data-active="showOptions || undefined" @click="toggleOptions">
          <SlidersHorizontalIcon :size="18" />
        </button>
        <button variant="outline" size="icon" class="global-search-view__close" @click="handleClose">
          <img :src="xIcon" :size="18" />
        </button>
      </div>
    </div>

    <div v-if="showOptions" class="global-search-view__options">
      <div class="global-search-view__options-group">
        <span class="global-search-view__options-group-title">results</span>
        <div class="global-search-view__options-row">
          <input
            id="include-files"
            v-model="includeFiles"
            type="checkbox"
            class="global-search-view__option-checkbox"
          />
          <label for="include-files" class="global-search-view__option-label">
            'globalSearch.showFiles'
          </label>
        </div>
        <div class="global-search-view__options-row">
          <input
            id="include-directories"
            v-model="includeDirectories"
            type="checkbox"
            class="global-search-view__option-checkbox"
          />
          <label for="include-directories" class="global-search-view__option-label">
            'globalSearch.showDirectories'
          </label>
        </div>
      </div>

      <div class="global-search-view__options-group">
        <span class="global-search-view__options-group-title">options</span>
        <div class="global-search-view__options-row">
          <input
            id="exact-match"
            v-model="exactMatch"
            type="checkbox"
            class="global-search-view__option-checkbox"
          />
          <label for="exact-match" class="global-search-view__option-label">
            'globalSearch.exactMatch'
          </label>
        </div>
        <div class="global-search-view__options-row">
          <input
            id="typo-tolerance"
            v-model="typoTolerance"
            type="checkbox"
            class="global-search-view__option-checkbox"
          />
          <label for="typo-tolerance" class="global-search-view__option-label">
            'globalSearch.typoTolerance'
          </label>
        </div>
      </div>

      <div class="global-search-view__options-group">
        <span class="global-search-view__options-group-title">result limit</span>
        <NumberField :model-value="resultLimit" class="global-search-view__options-limit-field" :min="10" :max="500"
          :step="10">
          <NumberFieldContent>
            <NumberFieldDecrement />
            <NumberFieldInput />
            <NumberFieldIncrement />
          </NumberFieldContent>
        </NumberField>
      </div>
    </div>

    <div class="global-search-view__content">
      <div v-if="showScanProgress" class="global-search-view__scan-status">
        <div class="global-search-view__scan-info">
          <span class="global-search-view__scan-text">
            {{ isCommitting ? 'globalSearch.indexStatus.committing' : (globalSearchStore.isParallelScan ?
              'globalSearch.scanningInParallel' : 'globalSearch.driveScanInProgress') }}
          </span>
          <span v-if="globalSearchStore.currentDriveRoot && !isCommitting && !globalSearchStore.isParallelScan"
            class="global-search-view__scan-drive">
            {{ globalSearchStore.currentDriveRoot }}
          </span>
          <span v-if="!isCommitting" class="global-search-view__scan-count">
            {{ globalSearchStore.scannedDrivesCount }} / {{ globalSearchStore.totalDrivesCount }}
          </span>
        </div>
        <div class="global-search-view__scan-progress-bar">
          <div class="global-search-view__scan-progress-bar-fill"
            :style="{ width: isCommitting ? '100%' : `${globalSearchStore.scanProgress}%` }" />
        </div>
        <div class="global-search-view__scan-items">
          {{ `globalSearch.indexedItems, ${globalSearchStore.indexedItemCount.toLocaleString()}` }}
        </div>
      </div>

      <div v-if="globalSearchStore.results.length > 0" class="global-search-view__results-header">
        {{ `globalSearch.searchStats.foundOnDrives, ${totalResultsCount}, ${groupedResults.length}` }}
      </div>

      <div class="global-search-view__results">
        <div class="global-search-view__results-inner">
          <EmptyState v-if="!hasIndexData && !globalSearchStore.isScanInProgress && !globalSearchStore.isCommitting"
            :icon="searchIcon" :title="'globalSearch.searchDataIncomplete'"
            :description="'globalSearch.noDrivesSelected'" :bordered="false" />

          <div v-else-if="!globalSearchStore.query.trim()" class="global-search-view__empty">
            <img :src="searchIcon" :size="48" class="global-search-view__empty-icon" />
            <span class="global-search-view__empty-title">
              'globalSearch.globalSearch'
            </span>
            <span class="global-search-view__empty-description">
              {{ `globalSearch.searchStats.searched', ${ globalSearchStore.indexedItemCount.toLocaleString() }` }}
              ({{ `globalSearch.searchStats.searchingLevelsDeep, ${ scanDepth }` }}<template
                v-if="lastScanRelative">, {{ `globalSearch.searchStats.indexed, ${
                  lastScanRelative
                }`.toLowerCase() }}</template>)
            </span>
            <button variant="outline" size="sm" class="global-search-view__settings-button" @click="openSearchSettings">
              <img :src="settingsIcon" :size="14" />
              'globalSearch.showSearchSettings'
            </button>
          </div>

          <EmptyState v-else-if="globalSearchStore.results.length === 0 && !globalSearchStore.isSearching"
            :icon="searchIcon" :title="'globalSearch.searchStats.nothingFound'" :bordered="false" />

          <template v-else-if="globalSearchStore.results.length > 0">
            <div v-for="group in groupedResults" :key="group.driveRoot" class="global-search-view__drive-group">
              <button class="global-search-view__drive-header" @click="toggleDriveCollapse(group.driveRoot)">
                <component :is="group.driveInfo?.is_removable ? UsbIcon : HardDriveIcon" :size="16"
                  class="global-search-view__drive-icon" />
                <span class="global-search-view__drive-name">
                  {{ group.driveInfo?.name || group.driveRoot }}
                </span>
                <span class="global-search-view__drive-count">
                  {{ `item, ${group.entries.length}` }}
                </span>
                <img :src="chevronDownIcon" :size="16" class="global-search-view__drive-chevron"
                  :class="{ 'global-search-view__drive-chevron--collapsed': isDriveCollapsed(group.driveRoot) }" />
              </button>

              <div v-if="!isDriveCollapsed(group.driveRoot)" class="global-search-view__list">
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

<style scoped>
.global-search-view {
  --results-header-height: 36px;
  --search-scroll-gutter: 18px;

  display: flex;
  height: 100%;
  flex-direction: column;
  border: 1px dashed hsl(var(--border));
}

.global-search-view__header {
  display: flex;
  align-items: center;
  padding: 8px;
  padding-bottom: 0;
  gap: 12px;
}

.global-search-view__search-container {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
}

.global-search-view__search-icon {
  position: absolute;
  left: 12px;
  color: hsl(var(--muted-foreground));
  pointer-events: none;
}

.global-search-view__search-icon--loading {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.global-search-view__input {
  flex: 1;
  padding-right: 40px;
  padding-left: 40px;
}

.global-search-view__clear-button {
  position: absolute;
  right: 4px;
  width: 32px;
  height: 32px;
}

.global-search-view__content {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: 0 8px;
  padding-right: 0;
}

.global-search-view__scan-status {
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  background-color: hsl(var(--primary) / 5%);
  gap: 8px;
}

.global-search-view__scan-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  font-size: 13px;
  gap: 8px;
}

.global-search-view__scan-text {
  color: hsl(var(--muted-foreground));
}

.global-search-view__scan-drive {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background-color: hsl(var(--primary) / 15%);
  color: hsl(var(--primary));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  font-weight: 500;
}

.global-search-view__scan-count {
  margin-left: auto;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}

.global-search-view__scan-progress-bar {
  position: relative;
  overflow: hidden;
  height: 4px;
  border-radius: 9999px;
  background-color: hsl(var(--secondary));
}

.global-search-view__scan-progress-bar-fill {
  height: 100%;
  border-radius: 9999px;
  background-color: hsl(var(--primary));
  transition: width 0.2s ease-out;
}

.global-search-view__scan-items {
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}

.global-search-view__results {
  flex: 1;
  overflow-y: auto;
}

.global-search-view__results-inner {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  padding-right: var(--search-scroll-gutter);
  gap: 2px;
}

.global-search-view__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  gap: 12px;
}

.global-search-view__empty-icon {
  color: hsl(var(--muted-foreground) / 30%);
}

.global-search-view__empty-title {
  color: hsl(var(--foreground));
  font-size: 16px;
  font-weight: 500;
}

.global-search-view__empty-description {
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}

.global-search-view__settings-button {
  margin-top: 8px;
  gap: 6px;
}

.global-search-view__header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.global-search-view__options-toggle {
  color: hsl(var(--muted-foreground));
}

.global-search-view__options-toggle[data-active] {
  background-color: hsl(var(--primary) / 10%);
  color: hsl(var(--primary));
}

.global-search-view__options {
  display: flex;
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  border-bottom: 1px solid hsl(var(--border));
  margin: 0 4px 16px;
  background-color: hsl(var(--muted) / 30%);
  gap: 24px;
}

.global-search-view__options-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.global-search-view__options-group-title {
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
}

.global-search-view__options-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.global-search-view__option-label {
  cursor: pointer;
  font-size: 13px;
  font-weight: 400;
}

.global-search-view__options-limit-field {
  width: 120px;
}

.global-search-view__results-header {
  height: var(--results-header-height);
  padding: 0 2px;
  background-color: transparent;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 500;
  line-height: var(--results-header-height);
}

.global-search-view__drive-header {
  position: sticky;
  z-index: 5;
  top: 0;
  display: flex;
  width: 100%;
  align-items: center;
  padding: 12px 16px;
  border: none;
  border-radius: var(--radius-sm);
  background-color: hsl(var(--background-2));
  color: hsl(var(--foreground));
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  gap: 10px;
  text-align: left;
}

.global-search-view__drive-header:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
}

.global-search-view__drive-icon {
  flex-shrink: 0;
  color: hsl(var(--primary));
}

.global-search-view__drive-name {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.global-search-view__drive-count {
  padding: 2px 8px;
  border-radius: 9999px;
  background-color: hsl(var(--secondary));
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 500;
}

.global-search-view__drive-chevron {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
  transition: transform 0.15s ease-out;
}

.global-search-view__drive-chevron--collapsed {
  transform: rotate(-90deg);
}

.global-search-view__list {
  --file-browser-list-columns: minmax(120px, 1fr) minmax(50px, 100px) minmax(60px, 140px);

  display: flex;
  flex-direction: column;
}

.global-search-view__list :deep(.file-browser__content) {
  --file-browser-list-right-gutter: 0;
}
</style>