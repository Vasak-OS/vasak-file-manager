<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	Badge,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Kbd,
	ListRow,
	Popover,
	PopoverAnchor,
	PopoverContent,
	SearchField,
	ThemeIcon,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@vasakgroup/vue-libvasak';
import { computed, nextTick, ref, watch } from 'vue';
import { useElementWidth } from '@/composables/use-element-width';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { interpolar } from '@/tools/interpolar';
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
		return interpolar(t('fileBrowser.matchedNOfItems'), matched, total);
	}

	if (total > MAX_VISIBLE_ITEMS) {
		// `displayed` y no los que quedan escondidos: la frase es «Mostrando
		// {0} de {1} elementos», así que con la cuenta de escondidos decía
		// «Mostrando 45 de 53» mientras se veían 8. No se notaba porque lo que
		// se dibujaba era la clave, no la frase.
		return interpolar(t('fileBrowser.showingNOfItems'), displayed, total);
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

/**
 * Cuánto mide la barra, para saber qué entra.
 *
 * Por debajo de 400 píxeles los botones pasan a un menú, y por debajo de 600
 * pierden el texto y quedan sólo con el icono (el nombre sigue en el
 * `aria-label` y en el globo). Antes eran dos consultas de contenedor sobre
 * clases propias; con `ActionButton` el texto es una propiedad, así que el
 * ancho se mide (`useElementWidth`).
 */
const container = ref<HTMLElement | null>(null);
const width = useElementWidth(container);

const isCollapsed = computed(() => width.value < 400);
const showsButtonText = computed(() => width.value >= 600);

/** El texto del botón sólo si entra; si no, queda de nombre accesible. */
function buttonLabel(text: string): string {
	return showsButtonText.value ? text : '';
}

function openCollapsedPopover() {
	nextTick(() => {
		setTimeout(() => {
			clipboardItemsPopoverOpen.value = true;
		}, 200);
	});
}
</script>

<template>
  <Transition name="clipboard-slide">
    <div v-if="clipboardStore.showToolbar" ref="container" class="absolute bottom-1 left-0 right-0 z-40 flex justify-center px-4 pb-4 pointer-events-none">
      <Popover :open="clipboardItemsPopoverOpen" @update:open="(open) => clipboardItemsPopoverOpen = open">
        <PopoverAnchor as-child>
          <div class="pointer-events-auto flex min-h-10 min-w-0 max-w-full items-center justify-between gap-4 rounded-corner-l border border-ui-line px-4 text-body-s text-tx-main shadow-surface-m" :class="{
            'bg-status-success/70': clipboardStore.isCopyOperation,
            'bg-status-warning/70': clipboardStore.isMoveOperation,
          }">
            <div class="flex min-w-0 items-center gap-3 overflow-hidden">
              <ThemeIcon
                :name="clipboardStore.isCopyOperation ? 'edit-copy' : 'folder-open'"
                type="symbol"
                :size="18"
                class="shrink-0" />
              <div class="flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
                <span class="truncate font-medium text-label-s">
                  {{ clipboardStore.isCopyOperation ? t('fileBrowser.preparedForCopying') :
                    t('fileBrowser.preparedForMoving') }}
                </span>
                <Badge variant="overlay" size="sm">
                  {{ t('fileBrowser.itemsPrepared') }} {{ clipboardStore.itemCount }}
                </Badge>
              </div>
            </div>

            <div v-if="!isCollapsed" class="flex shrink-0 items-center gap-1.5">
              <ActionButton
                :label="buttonLabel(t('fileBrowser.showItems'))"
                :icon-alt="t('fileBrowser.showItems')"
                :title="t('fileBrowser.showItems')"
                icon="redeyes-symbolic"
                variant="ghost"
                size="sm"
                @click="clipboardItemsPopoverOpen = true" />

              <template v-if="isSplitView">
                <Tooltip :delay-duration="300">
                  <TooltipTrigger>
                    <ActionButton
                      :label="buttonLabel(t('fileBrowser.actions.pasteToPane1'))"
                      :icon-alt="t('fileBrowser.actions.pasteToPane1')"
                      icon="edit-paste"
                      variant="ghost"
                      size="sm"
                      :disabled="!canPasteToPane1"
                      @click="emit('pasteToPane', 0)" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t('shortcuts.transferPreparedToPane1') }}
                    <Kbd class="ml-2">{{ shortcutsStore.getShortcutLabel('paste') }}</Kbd>
                  </TooltipContent>
                </Tooltip>

                <Tooltip :delay-duration="300">
                  <TooltipTrigger>
                    <ActionButton
                      :label="buttonLabel(t('fileBrowser.actions.pasteToPane2'))"
                      :icon-alt="t('fileBrowser.actions.pasteToPane2')"
                      icon="edit-paste"
                      variant="ghost"
                      size="sm"
                      :disabled="!canPasteToPane2"
                      @click="emit('pasteToPane', 1)" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t('shortcuts.transferPreparedToPane2') }}
                    <Kbd class="ml-2">{{ shortcutsStore.getShortcutLabel('paste') }}</Kbd>
                  </TooltipContent>
                </Tooltip>
              </template>

              <Tooltip v-else :delay-duration="300">
                <TooltipTrigger>
                  <ActionButton
                    :label="buttonLabel(t('fileBrowser.actions.paste'))"
                    :icon-alt="t('fileBrowser.actions.paste')"
                    icon="edit-paste"
                    variant="ghost"
                    size="sm"
                    :disabled="!canPaste"
                    @click="emit('paste')" />
                </TooltipTrigger>
                <TooltipContent>
                  {{ t('shortcuts.transferPreparedForCopying') }}
                  <Kbd class="ml-2">{{ shortcutsStore.getShortcutLabel('paste') }}</Kbd>
                </TooltipContent>
              </Tooltip>

              <ActionButton
                :label="buttonLabel(t('fileBrowser.discardClipboard'))"
                :icon-alt="t('fileBrowser.discardClipboard')"
                :title="t('fileBrowser.discardClipboard')"
                icon="window-close"
                variant="ghost"
                size="sm"
                @click="clipboardStore.clearClipboard()" />
            </div>

            <div v-else class="flex shrink-0 items-center">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <ActionButton
                    label=""
                    :icon-alt="t('actions')"
                    :title="t('actions')"
                    icon="view-more"
                    variant="ghost"
                    size="sm" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" class="min-w-45">
                  <DropdownMenuItem icon="redeyes-symbolic" @click="openCollapsedPopover">
                    {{ t('fileBrowser.showItems') }}
                  </DropdownMenuItem>
                  <template v-if="isSplitView">
                    <DropdownMenuItem icon="edit-paste" :disabled="!canPasteToPane1" @click="emit('pasteToPane', 0)">
                      {{ t('fileBrowser.actions.pasteToPane1') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem icon="edit-paste" :disabled="!canPasteToPane2" @click="emit('pasteToPane', 1)">
                      {{ t('fileBrowser.actions.pasteToPane2') }}
                    </DropdownMenuItem>
                  </template>
                  <DropdownMenuItem v-else icon="edit-paste" :disabled="!canPaste" @click="emit('paste')">
                    {{ t('fileBrowser.actions.paste') }}
                  </DropdownMenuItem>
                  <DropdownMenuItem icon="window-close" danger @click="clipboardStore.clearClipboard()">
                    {{ t('fileBrowser.discardClipboard') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent align="center" side="top" :side-offset="8" padding="sm" class="w-80" :label="t('fileBrowser.showItems')">
          <div class="flex flex-col gap-2">
            <SearchField v-model="clipboardItemsFilterQuery" :placeholder="t('filter.filter')" :label="t('filter.filter')" />
            <div v-if="clipboardItemsHeader" class="px-3 py-1 text-label-xs text-tx-muted">
              {{ clipboardItemsHeader }}
            </div>
            <!-- La lista desplaza sola: la barra de desplazamiento la pone
                 `scrollbar.css`, la de todas las ventanas. -->
            <div class="h-50 overflow-y-auto">
              <div class="flex flex-col gap-0.5">
                <ListRow
                  v-for="entry in displayedClipboardItems"
                  :key="entry.path"
                  :title="entry.name"
                  :description="entry.path"
                  truncate>
                  <template #trailing>
                    <ActionButton
                      label=""
                      :icon-alt="t('fileBrowser.removeFromClipboard')"
                      :title="t('fileBrowser.removeFromClipboard')"
                      icon="window-close"
                      variant="ghost"
                      size="sm"
                      @click="removeClipboardItem(entry)" />
                  </template>
                </ListRow>
                <p v-if="displayedClipboardItems.length === 0" class="m-0 p-4 text-center text-body-xs text-tx-muted">
                  {{ t('fileBrowser.noMatchingItems') }}
                </p>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  </Transition>
</template>

<style scoped>
.clipboard-slide-enter-active {
  transition:
    transform 0.2s var(--ease-ui-out),
    opacity 0.2s var(--ease-ui-out);
}

.clipboard-slide-leave-active {
  transition:
    transform 0.15s var(--ease-ui),
    opacity 0.15s var(--ease-ui);
}

.clipboard-slide-enter-from,
.clipboard-slide-leave-to {
  opacity: 0;
  transform: translateY(100%);
}
</style>
