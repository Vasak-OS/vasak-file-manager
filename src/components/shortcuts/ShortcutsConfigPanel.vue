<script setup lang="ts">
import { ref, computed } from 'vue';
import {
	useShortcutsStore,
	formatShortcutKeys,
	type ShortcutDefinition,
} from '@/stores/runtime/shortcuts';
import type { ShortcutKeys } from '@/types/shortcut';

const shortcutsStore = useShortcutsStore();

const editingShortcutId = ref<string | null>(null);
const recordedKeys = ref<ShortcutKeys | null>(null);
const conflictWarning = ref<ShortcutDefinition | null>(null);

const scopeLabels: Record<string, string> = {
	global: 'Global',
	navigator: 'Navigation',
	settings: 'Settings',
};

const shortcutsByScope = computed(() => shortcutsStore.shortcutsByScope);

function startEditing(shortcutId: string): void {
	const definition = shortcutsStore.getShortcutDefinition(shortcutId as any);
	if (!definition || definition.isReadOnly) return;

	editingShortcutId.value = shortcutId;
	recordedKeys.value = null;
	conflictWarning.value = null;
}

function cancelEditing(): void {
	editingShortcutId.value = null;
	recordedKeys.value = null;
	conflictWarning.value = null;
}

function handleKeydown(event: KeyboardEvent): void {
	if (!editingShortcutId.value) return;

	event.preventDefault();
	event.stopPropagation();

	// Ignore lone modifier keys
	if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

	const keys: ShortcutKeys = {
		key: event.key,
	};
	if (event.ctrlKey) keys.ctrl = true;
	if (event.altKey) keys.alt = true;
	if (event.shiftKey) keys.shift = true;
	if (event.metaKey) keys.meta = true;

	recordedKeys.value = keys;

	// Detect conflict in same scope
	const definition = shortcutsStore.getShortcutDefinition(editingShortcutId.value as any);
	if (definition) {
		conflictWarning.value = shortcutsStore.findConflictInScope(
			keys,
			definition.scope,
			definition.id
		);
	}
}

function saveAssignment(): void {
	if (!editingShortcutId.value || !recordedKeys.value || conflictWarning.value) return;

	const result = shortcutsStore.assignCustomKeys(
		editingShortcutId.value as any,
		recordedKeys.value
	);

	if (result.success) {
		cancelEditing();
	}
}

function resetSingle(shortcutId: string): void {
	shortcutsStore.resetShortcut(shortcutId as any);
}

function restoreAllDefaults(): void {
	shortcutsStore.restoreAllDefaults();
}

function getKeysLabel(definition: ShortcutDefinition): string {
	return formatShortcutKeys(shortcutsStore.getShortcutKeys(definition.id));
}
</script>

<template>
  <div class="shortcuts-config-panel p-4 text-ui-text overflow-y-auto max-h-full">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">Keyboard Shortcuts</h2>
      <button
        class="px-3 py-1.5 text-xs rounded bg-ui-surface border border-ui-border hover:bg-ui-surface-hover transition-colors"
        @click="restoreAllDefaults"
      >
        Restore Defaults
      </button>
    </div>

    <div v-for="(shortcuts, scope) in shortcutsByScope" :key="scope" class="mb-6">
      <h3 class="text-sm font-medium text-ui-text-muted mb-2 uppercase tracking-wider">
        {{ scopeLabels[scope] || scope }}
      </h3>

      <div class="space-y-1">
        <div
          v-for="shortcut in shortcuts"
          :key="shortcut.id"
          class="flex items-center justify-between py-2 px-3 rounded hover:bg-ui-surface/60 group"
          :class="{ 'bg-ui-surface': editingShortcutId === shortcut.id }"
        >
          <!-- Label -->
          <div class="flex-1 min-w-0">
            <span class="text-sm truncate block">{{ shortcut.labelKey }}</span>
            <span
              v-if="shortcut.isReadOnly"
              class="text-xs text-ui-text-muted"
            >Read-only</span>
          </div>

          <!-- Key binding display / editor -->
          <div class="flex items-center gap-2">
            <!-- Editing mode -->
            <template v-if="editingShortcutId === shortcut.id">
              <div class="flex items-center gap-2">
                <kbd
                  class="inline-flex items-center px-2 py-1 text-xs font-mono rounded border min-w-[80px] justify-center"
                  :class="conflictWarning ? 'border-red-500 bg-red-500/10 text-red-400' : 'border-ui-border bg-ui-surface text-ui-text'"
                  tabindex="0"
                  @keydown="handleKeydown"
                >
                  {{ recordedKeys ? formatShortcutKeys(recordedKeys) : 'Press keys...' }}
                </kbd>
                <button
                  v-if="recordedKeys && !conflictWarning"
                  class="px-2 py-1 text-xs rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-600/40"
                  @click="saveAssignment"
                >
                  ✓
                </button>
                <button
                  class="px-2 py-1 text-xs rounded bg-ui-surface text-ui-text-muted hover:bg-ui-surface-hover border border-ui-border"
                  @click="cancelEditing"
                >
                  ✕
                </button>
              </div>
              <!-- Conflict message -->
              <span v-if="conflictWarning" class="text-xs text-red-400 ml-2">
                Conflict: {{ conflictWarning.labelKey }}
              </span>
            </template>

            <!-- Normal display mode -->
            <template v-else>
              <kbd
                class="inline-flex items-center px-2 py-1 text-xs font-mono rounded border border-ui-border bg-ui-surface text-ui-text min-w-[80px] justify-center"
                :class="{ 'border-primary/50': shortcutsStore.isCustomized(shortcut.id) }"
              >
                {{ getKeysLabel(shortcut) }}
              </kbd>
              <button
                v-if="!shortcut.isReadOnly"
                class="px-2 py-1 text-xs rounded opacity-0 group-hover:opacity-100 bg-ui-surface hover:bg-ui-surface-hover border border-ui-border transition-opacity"
                @click="startEditing(shortcut.id)"
              >
                Edit
              </button>
              <button
                v-if="shortcutsStore.isCustomized(shortcut.id)"
                class="px-2 py-1 text-xs rounded opacity-0 group-hover:opacity-100 text-ui-text-muted hover:text-ui-text border border-ui-border transition-opacity"
                title="Reset to default"
                @click="resetSingle(shortcut.id)"
              >
                ↺
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
