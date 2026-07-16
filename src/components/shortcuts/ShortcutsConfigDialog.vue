<script setup lang="ts">
import { computed } from 'vue';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import ShortcutsConfigPanel from './ShortcutsConfigPanel.vue';

const shortcutsStore = useShortcutsStore();

const isVisible = computed(() => shortcutsStore.isConfigPanelVisible);

function close(): void {
	shortcutsStore.toggleConfigPanel();
}

function handleOverlayClick(event: MouseEvent): void {
	if ((event.target as HTMLElement).classList.contains('shortcuts-config-overlay')) {
		close();
	}
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="isVisible"
        class="shortcuts-config-overlay fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        role="dialog"
        aria-label="Keyboard shortcuts configuration"
        @click="handleOverlayClick"
        @keydown.escape="close"
      >
        <div
          class="bg-ui-bg border border-ui-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden mx-4 flex flex-col"
          tabindex="-1"
        >
          <div class="flex items-center justify-between px-4 pt-4 pb-2 border-b border-ui-border">
            <h2 class="text-lg font-semibold text-ui-text">Keyboard Shortcuts Configuration</h2>
            <button
              class="p-1 rounded hover:bg-ui-surface text-ui-text-muted hover:text-ui-text transition-colors"
              aria-label="Close"
              @click="close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto">
            <ShortcutsConfigPanel />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
