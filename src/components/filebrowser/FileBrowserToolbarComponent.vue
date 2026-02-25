<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import { ref } from 'vue';
import AddressBarComponent from '@/components/AddressBarComponent.vue';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu.vue';
import DropdownMenuContent from '@/components/ui/dropdown/DropdownMenuContent.vue';
import DropdownMenuItem from '@/components/ui/dropdown/DropdownMenuItem.vue';
import DropdownMenuTrigger from '@/components/ui/dropdown/DropdownMenuTrigger.vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import PopoverTrigger from '@/components/ui/popover/PopoverTrigger.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';

const props = defineProps<{
	pathInput: string;
	filterQuery: string;
	canGoBack: boolean;
	canGoForward: boolean;
	canGoUp: boolean;
	isLoading: boolean;
	isFilterOpen: boolean;
}>();

const emit = defineEmits<{
	(event: 'update:pathInput', value: string): void;
	(event: 'update:filterQuery', value: string): void;
	(event: 'update:isFilterOpen', value: boolean): void;
	(event: 'goBack'): void;
	(event: 'goForward'): void;
	(event: 'goUp'): void;
	(event: 'goHome'): void;
	(event: 'refresh'): void;
	(event: 'submitPath'): void;
	(event: 'navigateTo', path: string): void;
	(event: 'createNewDirectory'): void;
	(event: 'createNewFile'): void;
}>();

const shortcutsStore = useShortcutsStore();

const filterInputRef = ref<HTMLInputElement | null>(null);
const filterTriggerRef = ref<HTMLElement | ComponentPublicInstance | null>(null);

function handleFilterAutoFocus(event: Event) {
	event.preventDefault();
	filterInputRef.value?.focus();
}

function clearFilter() {
	emit('update:filterQuery', '');
}

function handleFilterQueryUpdate(value: string | number | undefined) {
	emit('update:filterQuery', String(value ?? ''));
}

function handleAddressBarNavigate(path: string) {
	emit('update:pathInput', path);
	emit('navigateTo', path);
}

function getFilterTriggerElement(): HTMLElement | null {
	const refValue = filterTriggerRef.value;
	if (!refValue) return null;
	if (refValue instanceof HTMLElement) return refValue;
	return (refValue as ComponentPublicInstance).$el as HTMLElement;
}

function handleFilterInteractOutside(event: Event) {
	const customEvent = event as CustomEvent<{ originalEvent: PointerEvent | FocusEvent }>;
	const target = customEvent.detail?.originalEvent?.target as Node | undefined;
	const triggerEl = getFilterTriggerElement();
	const isTriggerClick = triggerEl && target && triggerEl.contains(target);

	if (isTriggerClick) {
		event.preventDefault();

		return;
	}

	if (!props.filterQuery) {
		emit('update:isFilterOpen', false);
	} else {
		event.preventDefault();
	}
}
</script>

<template>
  <div class="file-browser-toolbar">
    <div class="file-browser-toolbar__nav-buttons file-browser-toolbar__nav-buttons--expanded">
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button" :disabled="!canGoBack"
            @click="emit('goBack')">
            <ArrowLeftIcon class="file-browser-toolbar__icon" />
          </button>
        </TooltipTrigger>
        <TooltipContent>'fileBrowser.goBack'</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button" :disabled="!canGoForward"
            @click="emit('goForward')">
            <ArrowRightIcon class="file-browser-toolbar__icon" />
          </button>
        </TooltipTrigger>
        <TooltipContent>'fileBrowser.goForward'</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button" :disabled="!canGoUp"
            @click="emit('goUp')">
            <ArrowUpIcon class="file-browser-toolbar__icon" />
          </button>
        </TooltipTrigger>
        <TooltipContent>'fileBrowser.goUp'</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button" @click="emit('goHome')">
            <HomeIcon class="file-browser-toolbar__icon" />
          </button>
        </TooltipTrigger>
        <TooltipContent>'fileBrowser.goHome'</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button" :disabled="isLoading"
            @click="emit('refresh')">
            <RefreshCwIcon class="file-browser-toolbar__icon" :class="{ 'animate-spin': isLoading }" />
          </button>
        </TooltipTrigger>
        <TooltipContent>'fileBrowser.refresh'</TooltipContent>
      </Tooltip>
    </div>

    <div class="file-browser-toolbar__nav-buttons file-browser-toolbar__nav-buttons--collapsed">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button"
            :title="'settingsCategories.navigation'">
            <EllipsisVerticalIcon class="file-browser-toolbar__icon" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" class="file-browser-toolbar__dropdown">
          <DropdownMenuItem :disabled="!canGoBack" @click="emit('goBack')">
            <ArrowLeftIcon :size="14" />
            'fileBrowser.goBack'
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!canGoForward" @click="emit('goForward')">
            <ArrowRightIcon :size="14" />
            'fileBrowser.goForward'
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!canGoUp" @click="emit('goUp')">
            <ArrowUpIcon :size="14" />
            'fileBrowser.goUp'
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('goHome')">
            <HomeIcon :size="14" />
            'fileBrowser.goHome'
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="isLoading" @click="emit('refresh')">
            <RefreshCwIcon :size="14" />
            'fileBrowser.refresh'
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div orientation="vertical" class="file-browser-toolbar__separator"></div>
    <div class="file-browser-toolbar__right">
      <AddressBarComponent :current-path="pathInput" class="file-browser-toolbar__address-bar"
        @navigate="handleAddressBarNavigate" />
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger as-child>
            <DropdownMenuTrigger as-child>
              <button type="button" class="file-browser-toolbar__create-button">
                <PlusIcon class="file-browser-toolbar__icon" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            'navigator.newDirectoryFile'
          </TooltipContent>
          <DropdownMenuContent align="end" side="bottom" class="file-browser-toolbar__dropdown">
            <DropdownMenuItem @click="emit('createNewDirectory')">
              <FolderPlusIcon :size="14" />
              'navigator.newDirectory'
            </DropdownMenuItem>
            <DropdownMenuItem @click="emit('createNewFile')">
              <FilePlusIcon :size="14" />
              'navigator.newFile'
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
      <Tooltip>
        <Popover :open="isFilterOpen" :modal="false" @update:open="emit('update:isFilterOpen', $event)">
          <TooltipTrigger as-child>
            <PopoverTrigger as-child>
              <button ref="filterTriggerRef" type="button" class="file-browser-toolbar__filter-button"
                :class="{ 'file-browser-toolbar__filter-button--active': filterQuery }">
                <TextSearchIcon class="file-browser-toolbar__icon" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            'fileBrowser.quickSearch'
            <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('toggleFilter') }}</kbd>
          </TooltipContent>
          <PopoverContent :side="'bottom'" :align="'end'" class="file-browser-toolbar__filter-popover"
            @open-auto-focus="handleFilterAutoFocus" @close-auto-focus.prevent
            @interact-outside="handleFilterInteractOutside">
            <div class="file-browser-toolbar__filter-input-wrapper">
              <input ref="filterInputRef" type="text" :value="filterQuery" placeholder="'fileBrowser.searchThisDirectory'"
                class="file-browser-toolbar__filter-input" @input="handleFilterQueryUpdate(($event.target as HTMLInputElement).value)" />
              <button v-if="filterQuery" type="button" class="file-browser-toolbar__filter-clear"
                @click="clearFilter">
                <XIcon :size="14" />
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </Tooltip>
    </div>
  </div>
</template>

<style scoped>
.file-browser-toolbar {
  display: flex;
  height: 48px;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid hsl(var(--border));
  container-type: inline-size;
  gap: 12px;
}

.file-browser-toolbar__nav-buttons {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}

.file-browser-toolbar__nav-buttons--expanded {
  display: flex;
}

.file-browser-toolbar__nav-buttons--collapsed {
  display: none;
}

.file-browser-toolbar__nav-button {
  width: 36px;
  height: 36px;
}

.file-browser-toolbar__icon {
  width: 18px;
  height: 18px;
}

.file-browser-toolbar__icon.animate-spin {
  animation: toolbar-spin 1s linear infinite;
}

@keyframes toolbar-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.file-browser-toolbar__separator {
  display: none;
  height: 20px;
}

.file-browser-toolbar__dropdown {
  min-width: 180px;
}

.file-browser-toolbar__right {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
}

.file-browser-toolbar__address-bar {
  min-width: 0;
  flex: 1;
}

.file-browser-toolbar__filter-button {
  width: 36px;
  height: 36px;
}

.file-browser-toolbar__create-button {
  width: 36px;
  height: 36px;
}

.file-browser-toolbar__filter-button--active {
  background-color: hsl(var(--secondary));
  color: hsl(var(--foreground));
}

.file-browser-toolbar__filter-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.file-browser-toolbar__filter-input {
  width: 100%;
  height: 36px;
  padding-right: 36px;
}

.file-browser-toolbar__filter-clear {
  position: absolute;
  right: 4px;
  width: 28px;
  height: 28px;
}

@container (width < 400px) {
  .file-browser-toolbar__separator {
    display: block;
  }

  .file-browser-toolbar__nav-buttons--expanded {
    display: none;
  }

  .file-browser-toolbar__nav-buttons--collapsed {
    display: flex;
  }
}
</style>

<style>
.file-browser-toolbar__filter-popover.sigma-ui-popover-content {
  width: 280px;
  padding: 8px;
}
</style>