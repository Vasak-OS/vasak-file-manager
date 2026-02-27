<script setup lang="ts">
import ContextMenuContent from '@/components/ui/contextmenu/ContextMenuContent.vue';
import ContextMenuItem from '@/components/ui/contextmenu/ContextMenuItem.vue';
import ContextMenuSeparator from '@/components/ui/contextmenu/ContextMenuSeparator.vue';
import { useFileBrowserContext } from '@/composables/file-browser/use-file-browser-context';
import FileBrowserActionsMenu from '@/components/filebrowser/FileBrowserActionMenuComponent.vue';

const ctx = useFileBrowserContext();

function handleAction(action: Parameters<typeof ctx.onContextMenuAction>[0]) {
	ctx.onContextMenuAction(action);
}

function handleOpenCustomDialog() {
	ctx.openOpenWithDialog(ctx.contextMenu.value.selectedEntries);
}
</script>

<template>
  <ContextMenuContent class="file-browser-context-menu">
    <FileBrowserActionsMenu :selected-entries="ctx.contextMenu.value.selectedEntries"
      :menu-item-component="ContextMenuItem" :menu-separator-component="ContextMenuSeparator" :is-context-menu="true"
      @action="handleAction" @open-custom-dialog="handleOpenCustomDialog" />
  </ContextMenuContent>
</template>

<style>
.file-browser-context-menu.sigma-ui-context-menu-content {
  min-width: 250px;
  max-width: 300px;
  padding: 8px;
}
</style>