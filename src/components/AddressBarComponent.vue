<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { dirname } from '@tauri-apps/api/path';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu.vue';
import DropdownMenuContent from '@/components/ui/dropdown/DropdownMenuContent.vue';
import DropdownMenuItem from '@/components/ui/dropdown/DropdownMenuItem.vue';
import DropdownMenuTrigger from '@/components/ui/dropdown/DropdownMenuTrigger.vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import PopoverTrigger from '@/components/ui/popover/PopoverTrigger.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import CustomSimple from '@/components/ui/toast/CustomSimple.vue';
import { toast } from '@/components/ui/toast/toaster';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import type { DirContents } from '@/types/dir-entry';
import { getSymbolSource } from '@vasakgroup/plugin-vicons';

const props = defineProps<{
	currentPath: string;
}>();

const emit = defineEmits<{
	navigate: [path: string];
}>();

const { t } = useI18n();

const isEditorOpen = ref(false);
const isPinned = ref(false);
const pathQuery = ref('');
const autocompleteList = ref<string[]>([]);
const selectedIndex = ref(-1);
const addressBarRef = ref<HTMLElement | null>(null);
const breadcrumbsContainerRef = ref<HTMLElement | null>(null);
const pathInputRef = ref<HTMLInputElement | null>(null);
const popoverWidth = ref(0);
const separatorDropdowns = ref<{ [key: number]: string[] }>({});
const openSeparatorIndex = ref<number | null>(null);
const isActionsMenuOpen = ref(false);
const copyIcon = ref('');
const clipboardPasteIcon = ref('');
const folderIcon = ref('');
const ellipsisVerticalIcon = ref('');
const chevronRightIcon = ref('');
const pinIcon = ref('');
const textCursorIcon = ref('');
const xIcon = ref('');
const ignoreNextEditorClose = ref(false);

function updatePopoverWidth() {
	if (addressBarRef.value) {
		popoverWidth.value = addressBarRef.value.offsetWidth;
	}
}

const addressParts = computed(() => {
	if (!props.currentPath) return [];

	const parts = props.currentPath.split('/').filter((part) => part !== '');
	const formattedParts: Array<{
		path: string;
		name: string;
		isLast: boolean;
	}> = [];

	parts.forEach((part, index) => {
		const pathSegments = parts.slice(0, index + 1);
		let fullPath = pathSegments.join('/');

		if (props.currentPath.startsWith('/')) {
			fullPath = `/${fullPath}`;
		} else if (!fullPath.includes(':')) {
			fullPath = `${fullPath}/`;
		} else if (index === 0 && fullPath.includes(':')) {
			fullPath = `${fullPath}/`;
		}

		formattedParts.push({
			path: fullPath,
			name: part,
			isLast: index === parts.length - 1,
		});
	});

	return formattedParts;
});

watch(
	() => props.currentPath,
	() => {
		nextTick(() => {
			scrollBreadcrumbsToEnd();
		});
	}
);

function scrollBreadcrumbsToEnd() {
	if (breadcrumbsContainerRef.value) {
		breadcrumbsContainerRef.value.scrollLeft = breadcrumbsContainerRef.value.scrollWidth;
	}
}

async function loadSeparatorDirectories(index: number) {
	const part = addressParts.value[index];
	if (!part) return;

	try {
		const result = await invoke<DirContents>('read_dir', { path: part.path });
		const directories = result.entries
			.filter((entry) => entry.is_dir)
			.map((entry) => ({
				path: entry.path,
				name: entry.name,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		separatorDropdowns.value[index] = directories.map((d) => d.path);
	} catch {
		separatorDropdowns.value[index] = [];
	}
}

function handleSeparatorNavigate(path: string) {
	emit('navigate', path);
}

function handleSeparatorOpenChange(index: number, open: boolean) {
  if (open) {
    loadSeparatorDirectories(index);
    openSeparatorIndex.value = index;
    return;
  }

  if (openSeparatorIndex.value === index) {
    openSeparatorIndex.value = null;
  }
}

async function openSeparatorMenu(index: number) {
  if (openSeparatorIndex.value === index) {
    openSeparatorIndex.value = null;
    return;
  }

  await loadSeparatorDirectories(index);
  openSeparatorIndex.value = index;
}

function scrollSelectedIntoView() {
	nextTick(() => {
		try {
			const selectedElement = document.querySelector('.address-bar__suggestion--selected');

			if (selectedElement?.parentElement) {
				selectedElement.scrollIntoView({
					block: 'nearest',
					behavior: 'smooth',
				});
			}
		} catch (error) {
			// Silently ignore DOM manipulation errors during scroll
			console.debug('Scroll error:', error);
		}
	});
}

function handleBreadcrumbsWheel(event: WheelEvent) {
	try {
		if (breadcrumbsContainerRef.value) {
			event.preventDefault();
			breadcrumbsContainerRef.value.scrollLeft += event.deltaY;
		}
	} catch (error) {
		console.debug('Breadcrumbs scroll error:', error);
	}
}

function navigateToPart(path: string) {
	emit('navigate', path);
}

async function openEditor() {
  ignoreNextEditorClose.value = true;
  setTimeout(() => {
    ignoreNextEditorClose.value = false;
  }, 0);

	const initialPath = props.currentPath;
	pathQuery.value = initialPath;
	selectedIndex.value = -1;
	updatePopoverWidth();
	isEditorOpen.value = true;

	await nextTick();
	pathInputRef.value?.focus();
	await updateAutocompleteList(initialPath);
}

function handleEditorOpenChange(open: boolean) {
  if (!open && ignoreNextEditorClose.value) {
    return;
  }

  if (open || !isPinned.value) {
    isEditorOpen.value = open;
  }
}

async function handlePathInput(value: string | number | undefined) {
	const stringValue = String(value ?? '');
	pathQuery.value = stringValue;
	selectedIndex.value = -1;
	await updateAutocompleteList(stringValue);
}

async function updateAutocompleteList(queryValue: string) {
	const normalizedQuery = queryValue;

	try {
		let dirPath = normalizedQuery;

		try {
			const result = await invoke<DirContents>('read_dir', { path: normalizedQuery });
			const entries = result.entries.filter((entry) => entry.is_dir).map((entry) => entry.path);
			autocompleteList.value = entries;

			if (normalizedQuery !== props.currentPath) {
				emit('navigate', normalizedQuery);
			}

			return;
		} catch {
			dirPath = await dirname(normalizedQuery);
		}

		const result = await invoke<DirContents>('read_dir', { path: dirPath });
		const queryLower = normalizedQuery.toLowerCase();
		const entries = result.entries
			.filter((entry) => entry.is_dir)
			.map((entry) => entry.path)
			.filter((path) => path.toLowerCase().startsWith(queryLower));

		autocompleteList.value = entries;
	} catch {
		autocompleteList.value = [];
	}
}

function handlePathSelect(path: string) {
	pathQuery.value = path;
	emit('navigate', path);

	if (!isPinned.value) {
		isEditorOpen.value = false;
	}
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter') {
		event.preventDefault();

		if (selectedIndex.value >= 0 && autocompleteList.value[selectedIndex.value]) {
			handlePathSelect(autocompleteList.value[selectedIndex.value]);
		} else if (pathQuery.value) {
			emit('navigate', pathQuery.value);

			if (!isPinned.value) {
				isEditorOpen.value = false;
			}
		}
	} else if (event.key === 'Escape') {
		isEditorOpen.value = false;
	} else if (event.key === 'ArrowDown') {
		event.preventDefault();

		if (autocompleteList.value.length > 0) {
			selectedIndex.value = (selectedIndex.value + 1) % autocompleteList.value.length;
			scrollSelectedIntoView();
		}
	} else if (event.key === 'ArrowUp') {
		event.preventDefault();

		if (autocompleteList.value.length > 0) {
			selectedIndex.value =
				selectedIndex.value <= 0 ? autocompleteList.value.length - 1 : selectedIndex.value - 1;
			scrollSelectedIntoView();
		}
	} else if (event.key === 'Tab') {
		event.preventDefault();
		event.stopPropagation();

		if (autocompleteList.value.length > 0) {
			if (event.shiftKey) {
				selectedIndex.value =
					selectedIndex.value <= 0 ? autocompleteList.value.length - 1 : selectedIndex.value - 1;
			} else {
				selectedIndex.value = (selectedIndex.value + 1) % autocompleteList.value.length;
			}

			if (autocompleteList.value[selectedIndex.value]) {
				pathQuery.value = autocompleteList.value[selectedIndex.value];
			}

			scrollSelectedIntoView();
		}

		// Keep focus on input
		pathInputRef.value?.focus();
	}
}

async function copyPathToClipboard() {
	try {
		await navigator.clipboard.writeText(props.currentPath);
		toast.custom(markRaw(CustomSimple), {
			componentProps: {
				title: 'dialogs.localShareManagerDialog.addressCopiedToClipboard',
				description: props.currentPath,
			},
			duration: 2000,
		});
	} catch (error) {
		console.error('Failed to copy path:', error);
	}
}

async function openCopiedPath() {
	try {
		const clipboardText = await navigator.clipboard.readText();

		if (clipboardText) {
			emit('navigate', clipboardText);
		}
	} catch (error) {
		console.error('Failed to read clipboard:', error);
	}
}

function handleGlobalKeydown(event: KeyboardEvent) {
	if (event.ctrlKey && event.key === 'p') {
		event.preventDefault();
		openEditor();
	}
}

onMounted(async() => {
	nextTick(() => {
		scrollBreadcrumbsToEnd();
	});
	window.addEventListener('keydown', handleGlobalKeydown);
  copyIcon.value = await getSymbolSource('edit-copy');
  clipboardPasteIcon.value = await getSymbolSource('edit-paste');
  folderIcon.value = await getSymbolSource('folder');
  ellipsisVerticalIcon.value = await getSymbolSource('view-more-symbolic');
  chevronRightIcon.value = await getSymbolSource('arrow-right');
  pinIcon.value = await getSymbolSource('pin');
  textCursorIcon.value = await getSymbolSource('edit-select-text')
  xIcon.value = await getSymbolSource('gtk-close');
});

onUnmounted(() => {
	window.removeEventListener('keydown', handleGlobalKeydown);
});
</script>

<template>
  <div ref="addressBarRef" class="address-bar relative flex overflow-hidden flex-1 h-10 items-center bg-ui-bg/80 rounded-corner gap-1 transition-colors p-1 border border-ui-border">
    <DropdownMenu v-model:open="isActionsMenuOpen">
      <Tooltip>
        <TooltipTrigger as-child>
          <DropdownMenuTrigger as-child :disabled="true">
            <button type="button" class="shrink-0 h-7 w-7 p-1" @click.stop="isActionsMenuOpen = true">
              <img :src="ellipsisVerticalIcon" :alt="t('settings.addressBar.addressBarActions')" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent :side="'bottom'" :align="'start'" class="address-bar__menu">
          <DropdownMenuItem @select="copyPathToClipboard">
            <img :src="copyIcon" alt="copy" class="h-4 w-4 inline-block mr-2" />
            <span>{{ t('settings.addressBar.copyPathToClipboard') }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem @select="openCopiedPath">
            <img :src="clipboardPasteIcon" alt="paste" class="h-4 w-4 inline-block mr-2" />
            <span>{{ t('settings.addressBar.openCopiedPath') }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
        <TooltipContent>
          {{ t('settings.addressBar.addressBarActions') }}
        </TooltipContent>
      </Tooltip>
    </DropdownMenu>
    <Popover :open="isEditorOpen" class="flex-1" @update:open="handleEditorOpenChange">
      <PopoverTrigger as-child>
        <div ref="breadcrumbsContainerRef" class="flex flex-1 h-full items-center overflow-x-auto cursor-text min-w-0" @wheel="handleBreadcrumbsWheel"
          @click="openEditor">
          <div class="flex min-w-max items-center overflow-x-auto pr-2">
            <template v-for="(part, index) in addressParts" :key="index">
              <button class="px-1.5 py-1 rounded-corner text-sm whitespace-nowrap hover:text-primary" :class="{ 'text-secondary': part.isLast }"
                :disabled="part.isLast" :title="part.path" @click.stop="navigateToPart(part.path)">
                {{ part.name }}
              </button>
              <DropdownMenu
                v-if="!part.isLast"
                :open="openSeparatorIndex === index"
                @update:open="(open: boolean) => handleSeparatorOpenChange(index, open)"
              >
                <DropdownMenuTrigger as-child>
                  <button class="address-bar__separator" :title="t('settings.addressBar.showSiblingDirectories')"
                    @click.stop="openSeparatorMenu(index)">
                    <img :src="chevronRightIcon" alt="Chevron Right" class="h-4 w-4" :size="12"
                      :class="{ 'address-bar__separator-icon--open': openSeparatorIndex === index }" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent :side="'bottom'" :align="'start'" class="address-bar__separator-menu">
                  <ScrollArea as-child class="address-bar__separator-menu-scroll">
                    <DropdownMenuItem v-for="dirPath in separatorDropdowns[index]" :key="dirPath"
                      @select="handleSeparatorNavigate(dirPath)" class="flex items-center justify-center">
                      <img :src="folderIcon" :alt="dirPath" class="h-4 w-4 inline-block mr-2" />
                      <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ dirPath.split('/').pop() || dirPath }}</span>
                    </DropdownMenuItem>
                  </ScrollArea>
                </DropdownMenuContent>
              </DropdownMenu>
            </template>
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent class="address-bar__editor" :style="{ width: `${popoverWidth}px` }" :side="'bottom'"
        :align="'end'" :side-offset="4" @open-auto-focus.prevent
        @escape-key-down="(event: KeyboardEvent) => { if (isPinned) event.preventDefault(); else isEditorOpen = false }"
        @pointer-down-outside="(event: Event) => { if (isPinned) event.preventDefault() }"
        @interact-outside="(event: Event) => { if (isPinned) event.preventDefault() }">
        <div class="address-bar__editor-header">
          <input ref="pathInputRef" type="text" :value="pathQuery" :placeholder="t('settings.addressBar.enterValidPath')"
            class="address-bar__path-input" @input="handlePathInput(($event.target as HTMLInputElement).value)" @keydown="handleKeydown" />
          <Tooltip>
            <TooltipTrigger as-child>
              <button type="button" tabindex="-1" class="address-bar__pin-button"
                :class="{ 'address-bar__pin-button--active': isPinned }" @click="isPinned = !isPinned">
                <img :src="pinIcon" :size="14" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {{ t('settings.addressBar.keepEditorOpened') }}
              <span v-if="isPinned" class="address-bar__tooltip-status">{{ t('enabled') }}
              </span>
              <span v-else class="address-bar__tooltip-status">{{ t('disabled') }}
              </span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button type="button" tabindex="-1" class="address-bar__close-button"
                @click="isEditorOpen = false">
                <img :src="xIcon" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {{ t('settings.addressBar.closeEditor') }}
              <kbd class="shortcut">Esc</kbd>
            </TooltipContent>
          </Tooltip>
        </div>

        <ScrollArea v-if="autocompleteList.length > 0">
          <button v-for="(path, index) in autocompleteList" :key="path" tabindex="-1" class="flex no-wrap items-center w-full px-3 py-1 text-sm gap-2 text-left"
            :class="{ 'bg-secondary': index === selectedIndex }" @click="handlePathSelect(path)"
            @mouseenter="selectedIndex = index">
            <img :src="folderIcon" :alt="path" class="h-4 w-4 inline-block mr-2" />
            <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ path }}</span>
          </button>
        </ScrollArea>

        <div v-else class="address-bar__empty">
          {{ t('settings.addressBar.noMatchingDirectories') }}
        </div>

        <div class="address-bar__editor-hints">
          <span class="address-bar__hint-key">↑↓</span>
          /
          <span class="address-bar__hint-key">Tab</span>
          /
          <span class="address-bar__hint-key">Shift+Tab</span>
          {{ t('settings.addressBar.toAutocomplete') }};
          <span class="address-bar__hint-key">Enter</span>
          {{ t('settings.addressBar.toOpenThePath') }}
        </div>
      </PopoverContent>
    </Popover>

    <Tooltip>
      <TooltipTrigger as-child>
        <button type="button" class="shrink-0 h-7 w-7 p-1" @click="openEditor">
          <img :src="textCursorIcon" :alt="t('settings.addressBar.editAddress')" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {{ t('settings.addressBar.editAddress') }}
        <kbd class="shortcut">Ctrl+P</kbd>
      </TooltipContent>
    </Tooltip>
  </div>
</template>

<style scoped>
.address-bar__separator {
  padding: 4px 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: hsl(var(--muted-foreground) / 60%);
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.1s, color 0.1s;
}

.address-bar__separator:hover {
  background-color: hsl(var(--secondary));
  color: hsl(var(--foreground));
}

.address-bar__separator:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

.address-bar__separator-icon--open {
  transform: rotate(90deg);
}

.address-bar__separator svg {
  transition: transform 0.1s ease-in-out;
}
</style>

<style>
.address-bar__menu.sigma-ui-dropdown-menu-content {
  min-width: 200px;
}

.address-bar__menu .sigma-ui-dropdown-menu-item {
  gap: 8px;
}

.address-bar__editor.sigma-ui-popover-content {
  min-width: 300px;
  padding: 0;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg);
  background-color: hsl(var(--background-3));
  box-shadow: 0 10px 40px hsl(var(--foreground) / 10%);
  color: hsl(var(--popover-foreground));
}

.address-bar__editor-header {
  display: flex;
  align-items: center;
  padding: 8px;
  gap: 4px;
}

.address-bar__path-input {
  height: 32px;
  flex: 1;
  margin-right: 8px;
  font-size: 13px;
}

.address-bar__pin-button,
.address-bar__close-button {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.address-bar__pin-button--active {
  background-color: hsl(var(--primary) / 15%);
  color: hsl(var(--primary));
}

.address-bar__pin-button--active svg {
  stroke: hsl(var(--primary));
}

.address-bar__suggestion {
  display: flex;
  width: 100%;
  align-items: center;
  padding: 4px 12px;
  border: none;
  background: transparent;
  color: hsl(var(--foreground));
  cursor: pointer;
  gap: 8px;
  text-align: left;
  transition: background-color 0.1s;
}


.address-bar__empty {
  padding: 12px;
  border-top: 1px solid hsl(var(--border));
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  text-align: center;
}

.address-bar__editor-hints {
  padding: 6px 10px;
  border-top: 1px solid hsl(var(--border));
  color: hsl(var(--muted-foreground));
  font-size: 10px;
}

.address-bar__hint-key {
  padding: 2px 5px;
  border-radius: var(--radius-sm);
  background-color: hsl(var(--muted));
  font-size: 10px;
}

.address-bar__tooltip-status {
  margin-left: 6px;
  color: hsl(var(--primary));
  font-weight: 500;
}

.address-bar__separator-menu.sigma-ui-dropdown-menu-content {
  min-width: 180px;
  max-width: 300px;
  padding: 0;
}

.address-bar__separator-menu-scroll {
  max-height: 250px;
  padding: 4px 0;
}

.address-bar__separator-menu .sigma-ui-dropdown-menu-item {
  padding: 6px 12px;
  font-size: 12px;
  gap: 8px;
}

.address-bar__separator-menu-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>