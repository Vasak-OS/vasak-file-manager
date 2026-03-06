<script setup lang="ts">
import { getSymbolSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu.vue';
import DropdownMenuContent from '@/components/ui/dropdown/DropdownMenuContent.vue';
import DropdownMenuItem from '@/components/ui/dropdown/DropdownMenuItem.vue';
import DropdownMenuTrigger from '@/components/ui/dropdown/DropdownMenuTrigger.vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverAnchor from '@/components/ui/popover/PopoverAnchor.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import type { DirEntry } from '@/types/dir-entry';

const MAX_VISIBLE_ITEMS = 100;

const props = defineProps<{
	currentPath?: string;
	isSplitView?: boolean;
	pane1Path?: string;
	pane2Path?: string;
}>();

const emit = defineEmits<{
	paste: [];
	pasteToPane: [paneIndex: number];
}>();

const { t } = useI18n();
const clipboardStore = useClipboardStore();
const shortcutsStore = useShortcutsStore();

const clipboardItemsPopoverOpen = ref(false);
const clipboardItemsFilterQuery = ref('');

const xIcon = ref('');
const eyeIcon = ref('');
const clipboardPasteIcon = ref('');

const canPaste = computed(() => {
	if (!clipboardStore.hasItems || !props.currentPath) {
		return false;
	}

	return clipboardStore.canPasteTo(props.currentPath);
});

const canPasteToPane1 = computed(() => {
	if (!clipboardStore.hasItems || !props.pane1Path) {
		return false;
	}

	return clipboardStore.canPasteTo(props.pane1Path);
});

const canPasteToPane2 = computed(() => {
	if (!clipboardStore.hasItems || !props.pane2Path) {
		return false;
	}

	return clipboardStore.canPasteTo(props.pane2Path);
});

const filteredClipboardItems = computed(() => {
	if (!clipboardItemsFilterQuery.value) {
		return clipboardStore.clipboardItems;
	}

	const query = clipboardItemsFilterQuery.value.toLowerCase();
	return clipboardStore.clipboardItems.filter(
		(entry) => entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query)
	);
});

const displayedClipboardItems = computed(() => {
	return filteredClipboardItems.value.slice(0, MAX_VISIBLE_ITEMS);
});

const clipboardItemsHeader = computed(() => {
	const total = clipboardStore.itemCount;
	const matched = filteredClipboardItems.value.length;
	const displayed = Math.min(matched, MAX_VISIBLE_ITEMS);

	if (clipboardItemsFilterQuery.value) {
		return `fileBrowser.matchedNOfItems, ${matched}, ${total}`;
	}

	if (total > MAX_VISIBLE_ITEMS) {
		const hidden = Math.max(total - displayed, 0);

		return `fileBrowser.showingNOfItems, ${hidden}, ${total}`;
	}

	return null;
});

watch(clipboardItemsPopoverOpen, (isOpen) => {
	if (!isOpen) {
		clipboardItemsFilterQuery.value = '';
	}
});

watch(
	() => clipboardStore.itemCount,
	(count) => {
		if (count === 0) {
			clipboardItemsPopoverOpen.value = false;
		}
	}
);

function removeClipboardItem(entry: DirEntry) {
	clipboardStore.removeFromClipboard(entry);
}

function openCollapsedPopover() {
	nextTick(() => {
		setTimeout(() => {
			clipboardItemsPopoverOpen.value = true;
		}, 200);
	});
}

onMounted(async () => {
	xIcon.value = await getSymbolSource('gtk-close');
	eyeIcon.value = await getSymbolSource('redeyes-symbolic');
	clipboardPasteIcon.value = await getSymbolSource('edit-paste');
});
</script>

<template>
  <Transition name="clipboard-slide">
    <div v-if="clipboardStore.showToolbar" class="clipboard-toolbar-container absolute bottom-1 left-0 right-0 z-40 flex justify-center px-4 pb-4 pointer-events-none">
      <Popover :open="clipboardItemsPopoverOpen" @update:open="(open) => clipboardItemsPopoverOpen = open">
        <PopoverAnchor as-child>
          <div class=" flex min-h-10 items-center justify-between px-4 rounded-corner gap-4 text-sm" :class="{
            'bg-status-success/70': clipboardStore.isCopyOperation,
            'bg-status-warning/70': clipboardStore.isMoveOperation,
          }">
            <div class="clipboard-toolbar__info">
              <div class="clipboard-toolbar__icon">
                <CopyIcon v-if="clipboardStore.isCopyOperation" :size="18" />
                <FolderInputIcon v-else :size="18" />
              </div>
              <div class="clipboard-toolbar__text">
                <span class="clipboard-toolbar__title">
                  {{ clipboardStore.isCopyOperation ? t('fileBrowser.preparedForCopying') :
                    t('fileBrowser.preparedForMoving') }}
                </span>
                <span class="clipboard-toolbar__count-tag">
                  {{ clipboardStore.isCopyOperation ? t('fileBrowser.itemsPrepared') : t('fileBrowser.itemsPrepared') }} {{ clipboardStore.itemCount }}
                </span>
              </div>
            </div>

            <div class="clipboard-toolbar__actions clipboard-toolbar__actions--expanded">
              <Button variant="ghost" size="sm" class="clipboard-toolbar__button" :title="t('fileBrowser.showItems')"
                @click="clipboardItemsPopoverOpen = true">
                <img :src="eyeIcon" :alt="t('fileBrowser.showItems')" class="h-4 w-4 inline-block" />
                <span class="clipboard-toolbar__button-text">{{ t('fileBrowser.showItems') }}</span>
              </Button>

              <template v-if="isSplitView">
                <Tooltip :delay-duration="300">
                  <TooltipTrigger as-child>
                    <button variant="ghost" size="sm" class="clipboard-toolbar__button"
                      :class="{ 'clipboard-toolbar__button--disabled': !canPasteToPane1 }" :disabled="!canPasteToPane1"
                      @click="emit('pasteToPane', 0)">
                      <img :src="clipboardPasteIcon" :alt="t('fileBrowser.actions.pasteToPane1')" class="h-4 w-4 inline-block" />
                      <span class="clipboard-toolbar__button-text">{{ t('fileBrowser.actions.pasteToPane1') }}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t('shortcuts.transferPreparedToPane1') }}
                    <kbd class="clipboard-toolbar__shortcut">{{ shortcutsStore.getShortcutLabel('paste') }}</kbd>
                  </TooltipContent>
                </Tooltip>

                <Tooltip :delay-duration="300">
                  <TooltipTrigger as-child>
                    <button variant="ghost" size="sm" class="clipboard-toolbar__button"
                      :class="{ 'clipboard-toolbar__button--disabled': !canPasteToPane2 }" :disabled="!canPasteToPane2"
                      @click="emit('pasteToPane', 1)">
                      <img :src="clipboardPasteIcon" :alt="t('fileBrowser.actions.pasteToPane2')" class="h-4 w-4 inline-block" />
                      <span class="clipboard-toolbar__button-text">{{ t('fileBrowser.actions.pasteToPane2') }}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t('shortcuts.transferPreparedToPane2') }}
                    <kbd class="clipboard-toolbar__shortcut">{{ shortcutsStore.getShortcutLabel('paste') }}</kbd>
                  </TooltipContent>
                </Tooltip>
              </template>

              <Tooltip v-else :delay-duration="300">
                <TooltipTrigger as-child>
                  <button variant="ghost" size="sm" class="clipboard-toolbar__button"
                    :class="{ 'clipboard-toolbar__button--disabled': !canPaste }" :disabled="!canPaste"
                    @click="emit('paste')">
                    <img :src="clipboardPasteIcon" :alt="t('fileBrowser.actions.paste')" class="h-4 w-4 inline-block" />
                    <span class="clipboard-toolbar__button-text">{{ t('fileBrowser.actions.paste') }}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {{ t('shortcuts.transferPreparedForCopying') }}
                  <kbd class="clipboard-toolbar__shortcut">{{ shortcutsStore.getShortcutLabel('paste') }}</kbd>
                </TooltipContent>
              </Tooltip>

              <button variant="ghost" size="sm" class="clipboard-toolbar__button clipboard-toolbar__button--discard"
                :title="t('fileBrowser.discardClipboard')" @click="clipboardStore.clearClipboard()">
                <img :src="xIcon" :alt="t('fileBrowser.discardClipboard')" class="h-4 w-4 inline-block" />
                <span class="clipboard-toolbar__button-text">{{ t('fileBrowser.discardClipboard') }}</span>
              </button>
            </div>

            <div class="clipboard-toolbar__actions clipboard-toolbar__actions--collapsed">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button variant="ghost" size="sm" class="clipboard-toolbar__button" :title="t('fileBrowser.actions')">
                    <EllipsisVerticalIcon :size="16" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" class="clipboard-toolbar__dropdown">
                  <DropdownMenuItem @click="openCollapsedPopover">
                    <img :src="eyeIcon" :alt="t('fileBrowser.showItems')" class="h-4 w-4 inline-block" />
                    {{ t('fileBrowser.showItems') }}
                  </DropdownMenuItem>
                  <template v-if="isSplitView">
                    <DropdownMenuItem :disabled="!canPasteToPane1" @click="emit('pasteToPane', 0)">
                      <img :src="clipboardPasteIcon" :alt="t('fileBrowser.actions.pasteToPane1')" class="h-4 w-4 inline-block" />
                      {{ t('fileBrowser.actions.pasteToPane1') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem :disabled="!canPasteToPane2" @click="emit('pasteToPane', 1)">
                      <img :src="clipboardPasteIcon" :alt="t('fileBrowser.actions.pasteToPane2')" class="h-4 w-4 inline-block" />
                      {{ t('fileBrowser.actions.pasteToPane2') }}
                    </DropdownMenuItem>
                  </template>
                  <DropdownMenuItem v-else :disabled="!canPaste" @click="emit('paste')">
                    <img :src="clipboardPasteIcon" :alt="t('fileBrowser.actions.paste')" class="h-4 w-4 inline-block" />
                    {{ t('fileBrowser.actions.paste') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem class="clipboard-toolbar__dropdown-item--discard"
                    @click="clipboardStore.clearClipboard()">
                    <img :src="xIcon" :alt="t('fileBrowser.discardClipboard')" class="h-4 w-4 inline-block" />
                    {{ t('fileBrowser.discardClipboard') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent align="center" side="top" :side-offset="8" class="clipboard-toolbar__popover">
          <div class="clipboard-toolbar__popover-content">
            <div class="clipboard-toolbar__filter-wrapper">
              <input v-model="clipboardItemsFilterQuery" :placeholder="t('filter.filter')"
                class="clipboard-toolbar__filter-input" />
            </div>
            <div v-if="clipboardItemsHeader" class="clipboard-toolbar__items-header">
              {{ clipboardItemsHeader }}
            </div>
            <ScrollArea class="clipboard-toolbar__scroll-area">
              <div class="clipboard-toolbar__items-list">
                <div v-for="entry in displayedClipboardItems" :key="entry.path" class="clipboard-toolbar__item">
                  <div class="clipboard-toolbar__item-info">
                    <span class="clipboard-toolbar__item-name">{{ entry.name }}</span>
                    <span class="clipboard-toolbar__item-path">{{ entry.path }}</span>
                  </div>
                  <Button variant="ghost" size="icon" class="clipboard-toolbar__item-remove"
                    :title="t('fileBrowser.removeFromClipboard')" @click="removeClipboardItem(entry)">
                    <img :src="xIcon" :alt="t('fileBrowser.removeFromClipboard')" class="h-4 w-4" />
                  </Button>
                </div>
                <div v-if="displayedClipboardItems.length === 0" class="clipboard-toolbar__no-items">
                  {{ t('fileBrowser.noMatchingItems') }}
                </div>
              </div>
            </ScrollArea>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  </Transition>
</template>

<style scoped>
.clipboard-toolbar-container {
  container-type: inline-size;
}

.clipboard-slide-enter-active {
  transition:
    transform 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.2s ease-out;
}

.clipboard-slide-leave-active {
  transition:
    transform 0.2s cubic-bezier(0.4, 0, 1, 1),
    opacity 0.15s ease-in;
}

.clipboard-slide-enter-from {
  opacity: 0;
  transform: translateY(100%);
}

.clipboard-slide-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

.clipboard-toolbar__info {
  display: flex;
  overflow: hidden;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.clipboard-toolbar__icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.clipboard-toolbar__text {
  display: flex;
  overflow: hidden;
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px;
}

.clipboard-toolbar__title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clipboard-toolbar__count-tag {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 4px;
  background-color: hsl(var(--background-3) / 80%);
  font-size: 12px;
  font-weight: 500;
}

.clipboard-toolbar__actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
}

.clipboard-toolbar__actions--expanded {
  display: flex;
}

.clipboard-toolbar__actions--collapsed {
  display: none;
}

@container (width < 400px) {
  .clipboard-toolbar__actions--expanded {
    display: none;
  }

  .clipboard-toolbar__actions--collapsed {
    display: flex;
  }
}

.clipboard-toolbar__button {
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  background-color: transparent;
  font-size: 12px;
  font-weight: 500;
  gap: 6px;
  transition:
    background-color 0.15s ease,
    transform 0.1s ease;
}

.clipboard-toolbar__button:hover {
  background-color: hsl(var(--background) / 40%);
}

.clipboard-toolbar__button:active {
  transform: scale(0.97);
}

.clipboard-toolbar__button-text {
  display: none;
}

@container (width >=600px) {
  .clipboard-toolbar__button-text {
    display: inline;
  }
}

.clipboard-toolbar__button--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.clipboard-toolbar__button--discard:hover {
  background-color: hsl(var(--destructive) / 30%);
  color: hsl(0deg 100% 70%);
}

.clipboard-toolbar__dropdown {
  min-width: 180px;
}

.clipboard-toolbar__dropdown-item--discard:hover,
.clipboard-toolbar__dropdown-item--discard:focus {
  background-color: hsl(var(--destructive) / 20%);
  color: hsl(var(--destructive));
}

.clipboard-toolbar__popover {
  width: 320px;
  padding: 0;
}

.clipboard-toolbar__popover-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.clipboard-toolbar__filter-input {
  width: 100%;
}

.clipboard-toolbar__items-header {
  padding: 4px 12px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
}

.clipboard-toolbar__scroll-area {
  height: 200px;
}

.clipboard-toolbar__scroll-area :deep(.sigma-ui-scroll-area-scrollbar) {
  right: -6px;
}

.clipboard-toolbar__items-list {
  display: flex;
  flex-direction: column;
  margin: 8px;
  gap: 2px;
}

.clipboard-toolbar__item {
  display: flex;
  align-items: stretch;
  border-radius: 4px;
  gap: 8px;
}

.clipboard-toolbar__item:hover {
  background-color: hsl(var(--secondary));
}

.clipboard-toolbar__item-info {
  display: flex;
  overflow: hidden;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  padding: 6px 0 6px 8px;
  gap: 2px;
}

.clipboard-toolbar__item-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clipboard-toolbar__item-path {
  overflow: hidden;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clipboard-toolbar__item-remove {
  flex-shrink: 0;
  align-self: stretch;
}

.clipboard-toolbar__no-items {
  padding: 16px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  text-align: center;
}
</style>

<style>
.clipboard-toolbar__shortcut {
  margin-left: 8px;
  opacity: 0.6;
}

.clipboard-toolbar__item .clipboard-toolbar__item-remove.sigma-ui-button.sigma-ui-button--size-icon {
  width: 36px;
  height: auto;
  min-height: 100%;
  border-radius: 0 4px 4px 0;
}
</style>