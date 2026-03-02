<script setup lang="ts">
import { getSymbolSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import type { ComponentPublicInstance } from 'vue';
import { onMounted, ref } from 'vue';
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
const { t } = useI18n();

const filterInputRef = ref<HTMLInputElement | null>(null);
const filterTriggerRef = ref<HTMLElement | ComponentPublicInstance | null>(null);
const isCreateMenuOpen = ref(false);
const plusIcon = ref('');
const folderPlusIcon = ref('');
const filePlusIcon = ref('');
const textSearchIcon = ref('');
const xIcon = ref('');
const arrowLeftIcon = ref('');
const arrowRightIcon = ref('');
const arrowUpIcon = ref('');
const homeIcon = ref('');
const refreshIcon = ref('');
const ellipsisVerticalIcon = ref('');

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

function handleCreateMenuButtonClick(event: MouseEvent) {
	event.preventDefault();
	event.stopPropagation();
	isCreateMenuOpen.value = !isCreateMenuOpen.value;
}

function handleCreateMenuOpenChange(value: boolean) {
	isCreateMenuOpen.value = value;
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

onMounted(async () => {
	plusIcon.value = await getSymbolSource('gtk-add');
	folderPlusIcon.value = await getSymbolSource('folder-new');
	filePlusIcon.value = await getSymbolSource('document-new');
	textSearchIcon.value = await getSymbolSource('system-search');
	xIcon.value = await getSymbolSource('dialog-close');
	arrowLeftIcon.value = await getSymbolSource('arrow-left');
	arrowRightIcon.value = await getSymbolSource('arrow-right');
	arrowUpIcon.value = await getSymbolSource('arrow-up');
	homeIcon.value = await getSymbolSource('user-home');
	refreshIcon.value = await getSymbolSource('refreshstructure');
	ellipsisVerticalIcon.value = await getSymbolSource('ellipsis-vertical');
});
</script>

<template>
  <div class="file-browser-toolbar">
    <div class="file-browser-toolbar__nav-buttons file-browser-toolbar__nav-buttons--expanded">
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button" :disabled="!canGoBack"
            @click="emit('goBack')">
            <img :src="arrowLeftIcon" :alt="t('fileBrowser.goBack')" class="file-browser-toolbar__icon" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('fileBrowser.goBack') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button" :disabled="!canGoForward"
            @click="emit('goForward')">
            <img :src="arrowRightIcon" :alt="t('fileBrowser.goForward')" class="file-browser-toolbar__icon" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('fileBrowser.goForward') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button" :disabled="!canGoUp"
            @click="emit('goUp')">
            <img :src="arrowUpIcon" :alt="t('fileBrowser.goUp')" class="file-browser-toolbar__icon" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('fileBrowser.goUp') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button" @click="emit('goHome')">
            <img :src="homeIcon" :alt="t('fileBrowser.goHome')" class="file-browser-toolbar__icon" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('fileBrowser.goHome') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button" :disabled="isLoading"
            @click="emit('refresh')">
            <img :src="refreshIcon" :alt="t('fileBrowser.refresh')" class="file-browser-toolbar__icon" :class="{ 'animate-spin': isLoading }" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('fileBrowser.refresh') }}</TooltipContent>
      </Tooltip>
    </div>

    <div class="file-browser-toolbar__nav-buttons file-browser-toolbar__nav-buttons--collapsed">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button type="button" class="file-browser-toolbar__nav-button"
            :title="t('fileBrowser.navigationMenu')">
            <img :src="ellipsisVerticalIcon" :alt="t('fileBrowser.navigationMenu')" class="file-browser-toolbar__icon" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" class="min-w-30">
          <DropdownMenuItem :disabled="!canGoBack" @click="emit('goBack')">
            <img :src="arrowLeftIcon" :alt="t('fileBrowser.goBack')" class="file-browser-toolbar__icon file-browser-toolbar__icon--small" />
            {{ t('fileBrowser.goBack') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!canGoForward" @click="emit('goForward')">
            <img :src="arrowRightIcon" :alt="t('fileBrowser.goForward')" class="file-browser-toolbar__icon file-browser-toolbar__icon--small" />
            {{ t('fileBrowser.goForward') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!canGoUp" @click="emit('goUp')">
            <img :src="arrowUpIcon" :alt="t('fileBrowser.goUp')" class="file-browser-toolbar__icon file-browser-toolbar__icon--small" />
            {{ t('fileBrowser.goUp') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('goHome')">
            <img :src="homeIcon" :alt="t('fileBrowser.goHome')" class="file-browser-toolbar__icon file-browser-toolbar__icon--small" />
            {{ t('fileBrowser.goHome') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="isLoading" @click="emit('refresh')">
            <img :src="refreshIcon" :alt="t('fileBrowser.refresh')" class="file-browser-toolbar__icon file-browser-toolbar__icon--small" />
            {{ t('fileBrowser.refresh') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div orientation="vertical" class="file-browser-toolbar__separator"></div>
    <div class="file-browser-toolbar__right">
      <AddressBarComponent :current-path="pathInput" class="file-browser-toolbar__address-bar"
        @navigate="handleAddressBarNavigate" />
      <DropdownMenu :open="isCreateMenuOpen" @update:open="handleCreateMenuOpenChange">
        <Tooltip>
          <DropdownMenuTrigger as-child>
            <TooltipTrigger as-child>
              <button type="button" class="h-9 w-9 flex justify-center items-center rounded-corner background hover:bg-primary"
                @click="handleCreateMenuButtonClick">
                <img :src="plusIcon" :alt="t('fileBrowser.createNew')" class="h-6 w-6" />
              </button>
            </TooltipTrigger>
          </DropdownMenuTrigger>
          <TooltipContent>{{ t('fileBrowser.newDirectoryFile') }}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" side="bottom" class="min-w-30">
          <DropdownMenuItem @click="emit('createNewDirectory')">
            <img :src="folderPlusIcon" :alt="t('fileBrowser.newDirectory')" class="inline-block h-4 w-4" />
            {{ t('fileBrowser.newDirectory') }}
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('createNewFile')">
            <img :src="filePlusIcon" :alt="t('fileBrowser.newFile')" class="inline-block h-4 w-4" />
            {{ t('fileBrowser.newFile') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <Popover :open="isFilterOpen" :modal="false" @update:open="emit('update:isFilterOpen', $event)">
          <TooltipTrigger as-child>
            <PopoverTrigger as-child>
              <button ref="filterTriggerRef" type="button" class="h-11 w-11 flex justify-center items-center rounded-corner background hover:bg-primary"
                :class="{ 'bg-primary': filterQuery }">
                <img :src="textSearchIcon" :alt="t('fileBrowser.filter')" class="h-6 w-6" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {{ t('fileBrowser.quickSearch') }}
            <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('toggleFilter') }}</kbd>
          </TooltipContent>
          <PopoverContent :side="'bottom'" :align="'end'" class="w-70 p-2"
            @open-auto-focus="handleFilterAutoFocus" @close-auto-focus.prevent
            @interact-outside="handleFilterInteractOutside">
            <div class="flex relative">
              <input ref="filterInputRef" type="text" :value="filterQuery" :placeholder="t('fileBrowser.searchThisDirectory')"
                class="h-8 w-full pr-8 rounded-corner" @input="handleFilterQueryUpdate(($event.target as HTMLInputElement).value)" />
              <button v-if="filterQuery" type="button" class="file-browser-toolbar__filter-clear"
                @click="clearFilter">
                <img :src="xIcon" :alt="t('fileBrowser.clearFilter')" class="file-browser-toolbar__icon file-browser-toolbar__icon--small" />
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