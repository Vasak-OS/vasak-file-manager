<script setup lang="ts">
import { computed } from 'vue';
import { useShortcutsStore, formatShortcutKeys } from '@/stores/runtime/shortcuts';

const shortcutsStore = useShortcutsStore();

const isVisible = computed(() => shortcutsStore.isQuickReferenceVisible);

/** Show all non-readonly shortcuts from the navigator scope (most common) + global */
const quickReferenceShortcuts = computed(() => {
	const all = shortcutsStore.definitions;
	// Group by scope, showing navigator and global (the most used in file browsing)
	const navigatorShortcuts = all
		.filter((s) => s.scope === 'navigator' && !s.isReadOnly)
		.map((s) => ({
			label: s.labelKey,
			keys: formatShortcutKeys(shortcutsStore.getShortcutKeys(s.id)),
		}));
	const globalShortcuts = all
		.filter((s) => s.scope === 'global' && !s.isReadOnly)
		.map((s) => ({
			label: s.labelKey,
			keys: formatShortcutKeys(shortcutsStore.getShortcutKeys(s.id)),
		}));

	return { navigator: navigatorShortcuts, global: globalShortcuts };
});

function close(): void {
	shortcutsStore.toggleQuickReference();
}

function handleOverlayClick(event: MouseEvent): void {
	if ((event.target as HTMLElement).classList.contains('quick-ref-overlay')) {
		close();
	}
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="isVisible"
        class="quick-ref-overlay fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        role="dialog"
        aria-label="Keyboard shortcuts quick reference"
        @click="handleOverlayClick"
        @keydown.escape="close"
      >
        <div
          class="quick-ref-panel bg-ui-bg border border-ui-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6 mx-4"
          tabindex="-1"
        >
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold text-ui-text">Quick Reference — Keyboard Shortcuts</h2>
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

          <p class="text-xs text-ui-text-muted mb-4">Press F1 or Escape to close</p>

          <!-- Global shortcuts -->
          <div v-if="quickReferenceShortcuts.global.length" class="mb-5">
            <h3 class="text-xs font-medium text-ui-text-muted uppercase tracking-wider mb-2">Global</h3>
            <div class="grid grid-cols-2 gap-x-6 gap-y-1">
              <div
                v-for="(shortcut, index) in quickReferenceShortcuts.global"
                :key="'global-' + index"
                class="flex items-center justify-between py-1"
              >
                <span class="text-sm text-ui-text truncate">{{ shortcut.label }}</span>
                <kbd class="ml-2 px-2 py-0.5 text-xs font-mono rounded border border-ui-border bg-ui-surface text-ui-text shrink-0">
                  {{ shortcut.keys }}
                </kbd>
              </div>
            </div>
          </div>

          <!-- Navigator shortcuts -->
          <div v-if="quickReferenceShortcuts.navigator.length">
            <h3 class="text-xs font-medium text-ui-text-muted uppercase tracking-wider mb-2">Navigation</h3>
            <div class="grid grid-cols-2 gap-x-6 gap-y-1">
              <div
                v-for="(shortcut, index) in quickReferenceShortcuts.navigator"
                :key="'nav-' + index"
                class="flex items-center justify-between py-1"
              >
                <span class="text-sm text-ui-text truncate">{{ shortcut.label }}</span>
                <kbd class="ml-2 px-2 py-0.5 text-xs font-mono rounded border border-ui-border bg-ui-surface text-ui-text shrink-0">
                  {{ shortcut.keys }}
                </kbd>
              </div>
            </div>
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
