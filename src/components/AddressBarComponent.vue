<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { dirname } from '@tauri-apps/api/path';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Kbd,
	Popover,
	PopoverAnchor,
	PopoverContent,
	ThemeIcon,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@vasakgroup/vue-libvasak';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { toast } from '@/components/ui/toast/toaster';
import type { DirContents } from '@/types/dir-entry';

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
		toast.success({
			title: 'dialogs.localShareManagerDialog.addressCopiedToClipboard',
			description: props.currentPath,
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

onMounted(async () => {
	nextTick(() => {
		scrollBreadcrumbsToEnd();
	});
	window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
	window.removeEventListener('keydown', handleGlobalKeydown);
});
</script>

<template>
  <div ref="addressBarRef" class="address-bar relative flex overflow-hidden flex-1 h-10 items-center bg-ui-bg/80 rounded-corner-m gap-1 transition-colors p-1 border border-ui-line">
    <DropdownMenu v-model:open="isActionsMenuOpen">
      <Tooltip>
        <TooltipTrigger>
          <DropdownMenuTrigger as-child :disabled="true">
            <button type="button" class="shrink-0 h-7 w-7 p-1" @click.stop="isActionsMenuOpen = true" :aria-label="t('settings.addressBar.addressBarActions')">
              <ThemeIcon name="view-more-symbolic" type="symbol" :size="16" :alt="t('settings.addressBar.addressBarActions')" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent :side="'bottom'" :align="'start'" class="min-w-[200px] [&_[role=menuitem]]:max-w-none [&_[role=menuitem]]:w-full [&_[role=menuitem]]:flex [&_[role=menuitem]]:gap-2">
          <DropdownMenuItem @select="copyPathToClipboard">
            <ThemeIcon name="edit-copy" type="symbol" :size="16" class="inline-block mr-2" />
            <span>{{ t('settings.addressBar.copyPathToClipboard') }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem @select="openCopiedPath">
            <ThemeIcon name="edit-paste" type="symbol" :size="16" class="inline-block mr-2" />
            <span>{{ t('settings.addressBar.openCopiedPath') }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
        <TooltipContent>
          {{ t('settings.addressBar.addressBarActions') }}
        </TooltipContent>
      </Tooltip>
    </DropdownMenu>
    <!-- El editor de la ruta cuelga de las migas (`PopoverAnchor`) pero no lo
         abren ellas por su cuenta: lo abre `openEditor`, con el clic o con el
         atajo. Un disparador de la librería alternaría en el mismo clic y lo
         volvería a cerrar. -->
    <Popover :open="isEditorOpen" @update:open="handleEditorOpenChange">
      <!-- El ancla es una caja propia y no las migas mismas: `as-child` le
           pone su `ref` al hijo y se llevaría puesto `breadcrumbsContainerRef`,
           que es el que desplaza las migas largas hasta el final. -->
      <PopoverAnchor as-child>
        <div class="flex h-full min-w-0 flex-1">
        <div ref="breadcrumbsContainerRef" class="flex flex-1 h-full items-center overflow-x-auto cursor-text min-w-0" @wheel="handleBreadcrumbsWheel"
          @click="openEditor" @keydown.enter.self="openEditor">
          <div class="flex min-w-max items-center overflow-x-auto pr-2">
            <template v-for="(part, index) in addressParts" :key="index">
              <button class="px-1.5 py-1 rounded-corner-m text-sm whitespace-nowrap hover:text-primary" :class="{ 'text-secondary': part.isLast }"
                :disabled="part.isLast" :title="part.path" @click.stop="navigateToPart(part.path)">
                {{ part.name }}
              </button>
              <DropdownMenu
                v-if="!part.isLast"
                :open="openSeparatorIndex === index"
                @update:open="(open: boolean) => handleSeparatorOpenChange(index, open)"
              >
                <DropdownMenuTrigger as-child>
                  <button class="px-1.5 py-1 border-none rounded-corner-m bg-transparent text-tx-muted/60 cursor-pointer text-[13px] transition-colors hover:bg-secondary hover:text-tx-main focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2" :title="t('settings.addressBar.showSiblingDirectories')"
                    @click.stop="openSeparatorMenu(index)" :aria-label="t('settings.addressBar.showSiblingDirectories')">
                    <ThemeIcon
                      name="arrow-right"
                      type="symbol"
                      :size="16"
                      class="transition-transform duration-100 ease-in-out"
                      :class="{ 'rotate-90': openSeparatorIndex === index }" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent :side="'bottom'" :align="'start'" class="min-w-[180px] max-w-[300px] p-0 [&_[role=menuitem]]:px-3 [&_[role=menuitem]]:py-1.5 [&_[role=menuitem]]:text-xs [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:w-full [&_[role=menuitem]]:flex">
                  <div class="max-h-62 overflow-y-auto py-1">
                    <DropdownMenuItem v-for="dirPath in separatorDropdowns[index]" :key="dirPath"
                      @select="handleSeparatorNavigate(dirPath)" class="flex items-center justify-start">
                      <ThemeIcon name="folder" :size="16" :alt="dirPath" class="inline-block shrink-0 mr-2" />
                      <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ dirPath.split('/').pop() || dirPath }}</span>
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </template>
          </div>
        </div>
        </div>
      </PopoverAnchor>
      <PopoverContent class="min-w-75" :style="{ width: `${popoverWidth}px` }" side="bottom" align="end"
        :side-offset="4" padding="none" :label="t('settings.addressBar.editAddress')">
        <div class="flex items-center p-2 gap-1">
          <input ref="pathInputRef" type="text" :value="pathQuery" :placeholder="t('settings.addressBar.enterValidPath')"
            :aria-label="t('settings.addressBar.enterValidPath')"
            class="mr-2 h-8 min-w-0 flex-1 bg-transparent text-body-s text-tx-main placeholder:text-tx-muted focus-visible:outline-none" @input="handlePathInput(($event.target as HTMLInputElement).value)" @keydown="handleKeydown" />
          <Tooltip>
            <TooltipTrigger>
              <ActionButton label="" :icon-alt="t('settings.addressBar.keepEditorOpened')" icon="pin" variant="ghost"
                size="sm" :pressed="isPinned" @click="isPinned = !isPinned" />
            </TooltipTrigger>
            <TooltipContent>
              {{ t('settings.addressBar.keepEditorOpened') }}
              <span v-if="isPinned" class="ml-1.5 text-primary font-medium">{{ t('enabled') }}
              </span>
              <span v-else class="ml-1.5 text-primary font-medium">{{ t('disabled') }}
              </span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <ActionButton label="" :icon-alt="t('settings.addressBar.closeEditor')" icon="window-close" variant="ghost"
                size="sm" @click="isEditorOpen = false" />
            </TooltipTrigger>
            <TooltipContent>
              {{ t('settings.addressBar.closeEditor') }}
              <Kbd class="shortcut">{{ t('keys.esc') }}</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>

        <div v-if="autocompleteList.length > 0">
          <button v-for="(path, index) in autocompleteList" :key="path" tabindex="-1" class="flex no-wrap items-center w-full px-3 py-1.5 text-body-s gap-2 text-left transition-colors duration-150 ease-ui"
            :class="{ 'bg-ui-selected': index === selectedIndex }" @click="handlePathSelect(path)"
            @mouseenter="selectedIndex = index">
            <ThemeIcon name="folder" :size="16" :alt="path" class="inline-block mr-2" />
            <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ path }}</span>
          </button>
        </div>

        <div v-else class="p-3 border-t border-ui-line-weak text-tx-muted text-body-xs text-center">
          {{ t('settings.addressBar.noMatchingDirectories') }}
        </div>

        <div class="flex flex-wrap items-center gap-1 px-2.5 py-1.5 border-t border-ui-line-weak text-tx-muted text-label-xs">
          <Kbd>↑↓</Kbd>
          /
          <Kbd>{{ t('keys.tab') }}</Kbd>
          /
          <Kbd>{{ t('keys.shiftTab') }}</Kbd>
          {{ t('settings.addressBar.toAutocomplete') }};
          <Kbd>{{ t('keys.enter') }}</Kbd>
          {{ t('settings.addressBar.toOpenThePath') }}
        </div>
      </PopoverContent>
    </Popover>

    <Tooltip>
      <TooltipTrigger>
        <ActionButton label="" :icon-alt="t('settings.addressBar.editAddress')" icon="edit-select-text" variant="ghost"
          size="sm" class="shrink-0" @click="openEditor" />
      </TooltipTrigger>
      <TooltipContent>
        {{ t('settings.addressBar.editAddress') }}
        <Kbd class="shortcut">{{ t('keys.ctrlP') }}</Kbd>
      </TooltipContent>
    </Tooltip>
  </div>
</template>
