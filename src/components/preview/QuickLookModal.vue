<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import FilePreviewPanel from '@/components/preview/FilePreviewPanel.vue';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import type { DirEntry } from '@/types/dir-entry';

const props = defineProps<{
  entry: DirEntry | null;
}>();

const isOpen = defineModel<boolean>('open', { default: false });

const shortcutsStore = useShortcutsStore();

function close() {
  isOpen.value = false;
}

function handleBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    close();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (!isOpen.value) return;

  const isEscape = event.key === 'Escape';
  const isSpace = event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey;

  if (isEscape || isSpace) {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
}

// Register shortcut handler to toggle Quick Look
onMounted(() => {
  shortcutsStore.registerHandler('toggleQuickLook', () => {
    isOpen.value = !isOpen.value;
    return undefined;
  }, {
    checkItemSelected: () => !!props.entry,
  });
});

onUnmounted(() => {
  shortcutsStore.unregisterHandler('toggleQuickLook');
  document.removeEventListener('keydown', handleKeydown, { capture: true });
});

// Key listener for closing (Space/Escape while modal is open)
watch(isOpen, (open) => {
  if (open) {
    document.addEventListener('keydown', handleKeydown, { capture: true });
  } else {
    document.removeEventListener('keydown', handleKeydown, { capture: true });
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="quicklook">
      <div
        v-if="isOpen && entry"
        class="fixed inset-0 z-[100] flex items-center justify-center"
        @click="handleBackdropClick"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />

        <!-- Modal content -->
        <div
          class="relative z-10 flex flex-col w-[85vw] max-w-5xl h-[80vh] max-h-[800px] rounded-corner border border-ui-border bg-ui-bg/95 shadow-2xl overflow-hidden"
          role="dialog"
          aria-modal="true"
          :aria-label="`Vista previa: ${entry.name}`"
        >
          <!-- Header -->
          <div class="flex items-center gap-3 px-4 py-3 border-b border-ui-border bg-ui-surface/30">
            <span class="text-sm font-medium text-tx-main truncate">{{ entry.name }}</span>
          </div>

          <!-- Preview body — reuses FilePreviewPanel with modal mode -->
          <div class="flex-1 overflow-hidden">
            <FilePreviewPanel :entry="entry" mode="modal" />
          </div>

          <!-- Footer hint -->
          <div class="flex items-center justify-center px-4 py-2 border-t border-ui-border bg-ui-surface/20">
            <span class="text-[11px] text-tx-muted">
              Presiona <kbd class="px-1 py-0.5 rounded bg-ui-surface text-tx-main text-[10px] font-mono">Espacio</kbd> o
              <kbd class="px-1 py-0.5 rounded bg-ui-surface text-tx-main text-[10px] font-mono">Esc</kbd> para cerrar
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.quicklook-enter-active {
  transition: opacity 0.2s ease-out;
}
.quicklook-leave-active {
  transition: opacity 0.15s ease-in;
}
.quicklook-enter-from,
.quicklook-leave-to {
  opacity: 0;
}
</style>
