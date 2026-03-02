<script setup lang="ts">
import { ref } from 'vue';
import ConflictDialogComponent from '@/components/dialogs/ConflictDialogComponent.vue';
import NewItemDialogComponent from '@/components/dialogs/NewItemDialogComponent.vue';
import OpenWithDialogComponent from '@/components/dialogs/OpenWithDialogComponent.vue';
import RenameDialogComponent from '@/components/dialogs/RenameDialogComponent.vue';
import FileBrowserContentComponent from '@/components/filebrowser/FileBrowserContentComponent.vue';
import FileBrowserDragOverlayComponent from '@/components/filebrowser/FileBrowserDragOverlayComponent.vue';
import FileBrowserInboundDragOverlayComponent from '@/components/filebrowser/FileBrowserInboundDragOverlayComponent.vue';
import FileBrowserStatusBarComponent from '@/components/filebrowser/FileBrowserStatusBarComponent.vue';
import FileBrowserToolbarComponent from '@/components/filebrowser/FileBrowserToolbarComponent.vue';
import { useFileBrowser } from '@/composables/file-browser/use-file-browser';
import { provideFileBrowserContext } from '@/composables/file-browser/use-file-browser-context';
import type { DirEntry } from '@/types/dir-entry';
import { Layout } from '@/types/navigator';
import type { Tab } from '@/types/workspaces';

const props = defineProps<{
	tab?: Tab;
	paneIndex?: number;
	layout?: Layout;
	externalEntries?: DirEntry[];
	basePath?: string;
	hideToolbar?: boolean;
	hideStatusBar?: boolean;
	entryDescription?: (entry: DirEntry) => string | undefined;
}>();

const emit = defineEmits<{
	'update:selectedEntries': [entries: DirEntry[]];
	'update:currentDirEntry': [entry: DirEntry | null];
	openEntry: [entry: DirEntry];
}>();

const fileBrowserRef = ref<HTMLElement | null>(null);

const fb = useFileBrowser({
	tab: () => props.tab,
	layout: () => props.layout,
	externalEntries: props.externalEntries ? () => props.externalEntries! : undefined,
	basePath: props.basePath !== undefined ? () => props.basePath! : undefined,
	onSelectedEntriesChange: (entries) => emit('update:selectedEntries', entries),
	onCurrentDirEntryChange: (entry) => emit('update:currentDirEntry', entry),
	onOpenEntry: (entry) => emit('openEntry', entry),
	componentRef: fileBrowserRef,
});

provideFileBrowserContext({
	entries: fb.entries,
	currentPath: fb.currentPath,
	isLoading: fb.isLoading,
	isDirectoryEmpty: fb.isDirectoryEmpty,
	error: fb.error,
	selectedEntries: fb.selectedEntries,
	isEntrySelected: fb.isEntrySelected,
	contextMenu: fb.contextMenu,
	getVideoThumbnail: fb.getVideoThumbnail,
	setEntriesContainerRef: fb.setEntriesContainerRef,
	onEntryMouseDown: fb.onEntryMouseDown,
	onEntryMouseUp: fb.onEntryMouseUp,
	handleEntryContextMenu: fb.handleEntryContextMenu,
	onContextMenuAction: fb.onContextMenuAction,
	openOpenWithDialog: fb.openOpenWithDialog,
	navigateToHome: fb.navigateToHome,
	entryDescription: props.entryDescription,
});

defineExpose({
	isFilterOpen: fb.isFilterOpen,
	selectedEntries: fb.selectedEntries,
	toggleFilter: fb.toggleFilter,
	openFilter: fb.openFilter,
	closeFilter: fb.closeFilter,
	navigateToPath: fb.navigateToPath,
	openFile: fb.openFile,
	clearSelection: fb.clearSelection,
	selectAll: fb.selectAll,
	selectFirstEntry: fb.selectFirstEntry,
	navigateUp: fb.navigateUp,
	navigateDown: fb.navigateDown,
	navigateLeft: fb.navigateLeft,
	navigateRight: fb.navigateRight,
	openSelected: fb.openSelected,
	navigateBack: fb.navigateBack,
	copyItems: fb.copyItems,
	cutItems: fb.cutItems,
	pasteItems: fb.pasteItems,
	deleteItems: fb.deleteItems,
	startRename: fb.startRename,
	quickView: fb.quickView,
});
</script>

<template>
  <div ref="fileBrowserRef" class="flex h-full flex-col relative overflow-hidden">
    <FileBrowserToolbarComponent v-if="!hideToolbar" v-model:path-input="fb.pathInput.value"
      v-model:filter-query="fb.filterQuery.value" v-model:is-filter-open="fb.isFilterOpen.value"
      :can-go-back="fb.canGoBack.value" :can-go-forward="fb.canGoForward.value" :can-go-up="!!fb.parentPath.value"
      :is-loading="fb.isLoading.value || fb.isRefreshing.value" @go-back="fb.goBack" @go-forward="fb.goForward"
      @go-up="fb.navigateToParent" @go-home="fb.navigateToHome" @refresh="fb.refresh" @submit-path="fb.handlePathSubmit"
      @navigate-to="fb.navigateToPath" @create-new-directory="fb.openNewItemDialog('directory')"
      @create-new-file="fb.openNewItemDialog('file')" />

    <FileBrowserContentComponent :layout="props.layout" />

    <FileBrowserStatusBarComponent v-if="!hideStatusBar" :dir-contents="fb.dirContents.value"
      :filtered-count="fb.entries.value.length" :selected-count="fb.selectedEntries.value.length"
      :selected-entries="fb.selectedEntries.value" @select-all="fb.selectAll" @deselect-all="fb.clearSelection"
      @remove-from-selection="fb.removeFromSelection" @context-menu-action="fb.onContextMenuAction" />

    <RenameDialogComponent v-model:open="fb.isRenameDialogOpen.value" :entry="fb.renameState.value.entry"
      @confirm="fb.handleRenameConfirm" @cancel="fb.handleRenameCancel" />

    <NewItemDialogComponent v-model:open="fb.isNewItemDialogOpen.value" :type="fb.newItemDialogState.value.type"
      @confirm="fb.handleNewItemConfirm" @cancel="fb.handleNewItemCancel" />

    <OpenWithDialogComponent v-model:open="fb.openWithState.value.isOpen" :entries="fb.openWithState.value.entries"
      @close="fb.closeOpenWithDialog" />

    <FileBrowserDragOverlayComponent :is-active="fb.isDragging.value" :item-count="fb.dragItems.value.length"
      :operation-type="fb.dragOperationType.value" :cursor-x="fb.dragCursorX.value" :cursor-y="fb.dragCursorY.value" />

    <Transition name="cross-pane-drop-overlay">
      <div v-if="fb.isCrossPaneTarget.value && !fb.isExternalMode" class="absolute z-50 border-2 border-dashed border-primary dark:border-primary-dark rounded-corner inset-0 pointer-events-none cross-pane-drop-overlay" />
    </Transition>

    <FileBrowserInboundDragOverlayComponent v-if="!fb.isExternalMode" :is-active="fb.isExternalDragActive.value"
      :item-count="fb.externalDragItemCount.value" :operation-type="fb.externalDragOperationType.value"
      :current-dir-locked="fb.isCurrentDirLocked.value" :targeting-entry="fb.isTargetingEntry.value" />

    <ConflictDialogComponent v-model:open="fb.conflictDialogState.value.isOpen"
      :conflicts="fb.conflictDialogState.value.conflicts"
      :operation-type="fb.conflictDialogState.value.operationType || 'copy'" @resolve="fb.handleConflictResolution"
      @cancel="fb.handleConflictCancel" />
  </div>
</template>
<style scoped>
.cross-pane-drop-overlay-enter-active {
  transition: opacity 0.15s ease-out;
}

.cross-pane-drop-overlay-leave-active {
  transition: opacity 0.1s ease-in;
}

.cross-pane-drop-overlay-enter-from,
.cross-pane-drop-overlay-leave-to {
  opacity: 0;
}
</style>