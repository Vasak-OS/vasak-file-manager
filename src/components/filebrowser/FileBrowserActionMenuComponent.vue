<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef } from 'vue';
import FileBrowserMoreOptionsSubmenu from '@/components/filebrowser/FileBrowserMoreOptionsSubMenuComponent.vue';
import FileBrowserOpenWithSubmenu from '@/components/filebrowser/FileBrowserOpenWithSubMenuComponent.vue';
import FileBrowserTerminalSubmenu from '@/components/filebrowser/FileBrowserTerminalSubMenuComponent.vue';
import TagSelector from '@/components/ui/TagSelector.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { useContextMenuItems } from '@/composables/file-browser/use-context-menu-items';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useUserStatsStore } from '@/stores/storage/user-stats';
import type { ContextMenuAction } from '@/types/contextMenu';
import type { DirEntry } from '@/types/dir-entry';

const props = defineProps<{
	selectedEntries: DirEntry[];
	menuItemComponent: object;
	menuSeparatorComponent: object;
	isContextMenu?: boolean;
}>();

const emit = defineEmits<{
	action: [action: ContextMenuAction];
	openCustomDialog: [];
}>();

function emitAction(action: ContextMenuAction) {
	emit('action', action);
}

function handleOpenCustomDialog() {
	emit('openCustomDialog');
}

function handleCopyClick() {
	emitAction('copy');
}

function handleCutClick() {
	emitAction('cut');
}

const clipboardStore = useClipboardStore();
const userStatsStore = useUserStatsStore();
const shortcutsStore = useShortcutsStore();

const { isActionVisible } = useContextMenuItems(toRef(props, 'selectedEntries'));

const allSelectedAreFavorites = computed(() => {
	return props.selectedEntries.every((entry) => userStatsStore.isFavorite(entry.path));
});

const availableTags = computed(() => userStatsStore.tags);

const selectedItemTagIds = computed(() => {
	if (props.selectedEntries.length === 0) return [];

	if (props.selectedEntries.length === 1) {
		const taggedItem = userStatsStore.taggedItems.find(
			(item) => item.path === props.selectedEntries[0].path
		);

		return taggedItem?.tagIds ?? [];
	}

	const allTagIds = props.selectedEntries.map((entry) => {
		const taggedItem = userStatsStore.taggedItems.find((item) => item.path === entry.path);

		return new Set(taggedItem?.tagIds ?? []);
	});

	const firstSet = allTagIds[0] ?? new Set();

	return Array.from(firstSet).filter((tagId) => allTagIds.every((tagSet) => tagSet.has(tagId)));
});

async function handleToggleTag(tagId: string) {
	const isCurrentlySelected = selectedItemTagIds.value.includes(tagId);

	for (const entry of props.selectedEntries) {
		if (isCurrentlySelected) {
			await userStatsStore.removeTagFromItem(entry.path, tagId);
		} else {
			await userStatsStore.addTagToItem(entry.path, tagId, entry.is_file);
		}
	}
}

async function handleCreateTag(name: string) {
	const colors = [
		'#ef4444',
		'#f97316',
		'#eab308',
		'#22c55e',
		'#14b8a6',
		'#3b82f6',
		'#8b5cf6',
		'#ec4899',
	];
	const randomColor = colors[Math.floor(Math.random() * colors.length)];
	const newTag = await userStatsStore.createTag(name, randomColor);

	for (const entry of props.selectedEntries) {
		await userStatsStore.addTagToItem(entry.path, newTag.id, entry.is_file);
	}
}

async function handleDeleteTag(tagId: string) {
	await userStatsStore.deleteTag(tagId);
}

const selectedDirectory = computed(() => {
	return props.selectedEntries.find((entry) => entry.is_dir);
});

const canPasteToSelectedDirectory = computed(() => {
	if (!clipboardStore.hasItems || !selectedDirectory.value) {
		return false;
	}

	return clipboardStore.canPasteTo(selectedDirectory.value.path);
});

const isShiftHeld = ref(false);

function handleKeyDown(event: KeyboardEvent) {
	if (event.key === 'Shift') {
		isShiftHeld.value = true;
	}
}

function handleKeyUp(event: KeyboardEvent) {
	if (event.key === 'Shift') {
		isShiftHeld.value = false;
	}
}

onMounted(() => {
	window.addEventListener('keydown', handleKeyDown);
	window.addEventListener('keyup', handleKeyUp);
});

onUnmounted(() => {
	window.removeEventListener('keydown', handleKeyDown);
	window.removeEventListener('keyup', handleKeyUp);
});

function handleDeleteClick() {
	emitAction(isShiftHeld.value ? 'delete-permanently' : 'delete');
}
</script>

<template>
  <div class="file-browser-actions-menu__quick-actions">
    <Tooltip :delay-duration="300" v-if="isActionVisible('rename')">
      <TooltipTrigger as-child>
        <button type="button" class="file-browser-actions-menu__icon-button" @click="emitAction('rename')">
          <PencilIcon :size="16" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        fileBrowser.actions.rename'
        <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('rename') }}</kbd>
      </TooltipContent>
    </Tooltip>
    <Tooltip :delay-duration="300" v-if="isActionVisible('copy')">
      <TooltipTrigger as-child>
        <button type="button" class="file-browser-actions-menu__icon-button" @click="handleCopyClick">
          <CopyIcon :size="16" />
        </button>
      </TooltipTrigger>
      <TooltipContent class="file-browser-actions-menu__tooltip">
        <div class="file-browser-actions-menu__tooltip-row">
          'fileBrowser.actions.copy'
          <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('copy') }}</kbd>
        </div>
      </TooltipContent>
    </Tooltip>
    <Tooltip :delay-duration="300" v-if="isActionVisible('cut')">
      <TooltipTrigger as-child>
        <button type="button" class="file-browser-actions-menu__icon-button" @click="handleCutClick">
          <FolderInputIcon :size="16" />
        </button>
      </TooltipTrigger>
      <TooltipContent class="file-browser-actions-menu__tooltip">
        <div class="file-browser-actions-menu__tooltip-row">
          'fileBrowser.actions.move'
          <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('cut') }}</kbd>
        </div>
      </TooltipContent>
    </Tooltip>
    <Tooltip :delay-duration="300" v-if="canPasteToSelectedDirectory">
      <TooltipTrigger as-child>
        <button type="button" class="file-browser-actions-menu__icon-button" @click="emitAction('paste')">
          <ClipboardPasteIcon :size="16" />
        </button>
      </TooltipTrigger>
      <TooltipContent class="file-browser-actions-menu__tooltip">
        <div class="file-browser-actions-menu__tooltip-row">
          'shortcuts.transferPreparedForCopying'
          <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('paste') }}</kbd>
        </div>
      </TooltipContent>
    </Tooltip>
    <Tooltip :delay-duration="300" v-if="isActionVisible('delete')">
      <TooltipTrigger as-child>
        <button type="button" class="file-browser-actions-menu__icon-button file-browser-actions-menu__action--danger"
          @click="handleDeleteClick">
          <ShredderIcon v-if="isShiftHeld" :size="16" />
          <Trash2Icon v-else :size="16" />
        </button>
      </TooltipTrigger>
      <TooltipContent class="file-browser-actions-menu__tooltip">
        <div class="file-browser-actions-menu__tooltip-row">
          'shortcuts.moveSelectedItemsToTrash'
          <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('delete') }}</kbd>
        </div>
        <div class="file-browser-actions-menu__tooltip-row">
          'shortcuts.deleteSelectedItemsFromDrive'
          <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('deletePermanently') }}</kbd>
        </div>
      </TooltipContent>
    </Tooltip>
  </div>
  <component :is="menuSeparatorComponent" />
  <FileBrowserOpenWithSubmenu v-if="isActionVisible('open-with') && isContextMenu" :selected-entries="selectedEntries"
    @open-custom-dialog="handleOpenCustomDialog" />
  <FileBrowserMoreOptionsSubmenu v-if="isContextMenu" :selected-entries="selectedEntries" />
  <component :is="menuItemComponent" v-if="isActionVisible('open-with') && !isContextMenu"
    @select="emitAction('open-with')" @click="emitAction('open-with')">
    <span>'fileBrowser.actions.openWith'</span>
  </component>
  <component :is="menuItemComponent" v-if="isActionVisible('quick-view')"
    class="file-browser-actions-menu__item-with-shortcut" @select="emitAction('quick-view')"
    @click="emitAction('quick-view')">
    <EyeIcon :size="16" />
    <span>'fileBrowser.actions.quickView'</span>
    <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('quickView') }}</kbd>
  </component>
  <FileBrowserTerminalSubmenu v-if="isContextMenu" :selected-entries="selectedEntries" :is-shift-held="isShiftHeld" />
  <component :is="menuItemComponent" v-if="isActionVisible('open-in-new-tab')"
    class="file-browser-actions-menu__item-with-shortcut" @select="emitAction('open-in-new-tab')"
    @click="emitAction('open-in-new-tab')">
    <PlusIcon :size="16" />
    <span>'fileBrowser.actions.openInNewTab'</span>
    <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('openNewTab') }}</kbd>
  </component>
  <component :is="menuItemComponent" v-if="isActionVisible('share')" @select="emitAction('share')"
    @click="emitAction('share')">
    <Share2Icon :size="16" />
    <span>'fileBrowser.actions.share'</span>
  </component>
  <component :is="menuSeparatorComponent" />
  <component :is="menuItemComponent" v-if="isActionVisible('toggle-favorite')" @select="emitAction('toggle-favorite')"
    @click="emitAction('toggle-favorite')">
    <StarIcon :size="16" :fill="allSelectedAreFavorites ? 'currentColor' : 'none'" />
    <span>{{ allSelectedAreFavorites ? 'fileBrowser.actions.removeFromFavorites' : 'fileBrowser.actions.addToFavorites' }}</span>
  </component>
  <div v-if="isActionVisible('edit-tags')" class="file-browser-actions-menu__tag-selector">
    <TagSelector :tags="availableTags" :selected-tag-ids="selectedItemTagIds" :allow-create="true" :max-badges="1"
      :full-width="true" trigger-variant="default" @toggle-tag="handleToggleTag" @create-tag="handleCreateTag"
      @delete-tag="handleDeleteTag" />
  </div>
</template>

<style>
.file-browser-actions-menu__quick-actions {
  display: flex;
  justify-content: center;
  gap: 4px;
}

.file-browser-actions-menu__icon-button {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.file-browser-actions-menu__icon-button:hover {
  background-color: hsl(var(--muted) / 60%);
}

.file-browser-actions-menu__icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.file-browser-actions-menu__action--danger:hover {
  color: hsl(var(--destructive));
}

.file-browser-actions-menu__tooltip {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-browser-actions-menu__tooltip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.file-browser-actions-menu__tag-selector {
  padding: 6px 0;
}

.file-browser-actions-menu__item-with-shortcut {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-browser-actions-menu__item-with-shortcut .shortcut {
  margin-left: auto;
  opacity: 0.6;
}
</style>