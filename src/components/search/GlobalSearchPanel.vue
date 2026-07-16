<script setup lang="ts">
import { ref } from 'vue';
import GlobalSearchView from '@/views/GlobalSearchView.vue';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import type { DirEntry } from '@/types/dir-entry';

type GlobalSearchViewInstance = InstanceType<typeof GlobalSearchView> & {
	getActiveFileBrowser?: () => any;
	clearSelections?: () => void;
};

const emit = defineEmits<{
	close: [];
	openEntry: [entry: DirEntry];
	'update:selectedEntries': [entries: DirEntry[]];
}>();

const globalSearchStore = useGlobalSearchStore();
const globalSearchViewRef = ref<GlobalSearchViewInstance | null>(null);

function handleClose() {
	emit('close');
}

function handleOpenEntry(entry: DirEntry) {
	emit('openEntry', entry);
}

function handleSelectedEntriesUpdate(entries: DirEntry[]) {
	emit('update:selectedEntries', entries);
}

function getActiveFileBrowser() {
	return globalSearchViewRef.value?.getActiveFileBrowser?.();
}

function clearSelections() {
	globalSearchViewRef.value?.clearSelections?.();
}

defineExpose({
	getActiveFileBrowser,
	clearSelections,
});
</script>

<template>
  <GlobalSearchView
    v-show="globalSearchStore.isOpen"
    ref="globalSearchViewRef"
    class="flex-1"
    @close="handleClose"
    @open-entry="handleOpenEntry"
    @update:selected-entries="handleSelectedEntriesUpdate"
  />
</template>
