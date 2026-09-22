<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ThemeIcon } from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import type { DragOperationType } from '@/composables/file-browser/use-file-browser-drag';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';
import { DirEntry } from '@/types/dir-entry';

const props = defineProps<{
	isActive: boolean;
	itemCount: number;
	operationType: DragOperationType;
	cursorX: number;
	cursorY: number;
	dragItems: DirEntry[];
}>();

const { t } = useI18n();

const overlayStyle = computed(() => ({
	left: `${props.cursorX + 16}px`,
	top: `${props.cursorY + 16}px`,
}));

const overlayIconStyle = computed(() => ({
	left: `${props.cursorX - 18}px`,
	top: `${props.cursorY - 18}px`,
}));

// Lo que se elige acá es el **nombre**: resolverlo es cosa de `ThemeIcon`, que
// además memoriza y vuelve a resolver solo cuando cambia el tema.
const operationIcon = computed(() =>
	props.operationType === 'copy' ? 'edit-copy' : 'folder-open'
);

const description = computed(() => {
	const base = props.operationType === 'copy' ? 'drag.copyItems' : 'drag.moveItems';
	return interpolar(t(claveSegunCantidad(base, props.itemCount)), props.itemCount);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="file-browser-drag-overlay">
      <div v-if="props.isActive" class="px-4 py-2 whitespace-nowrap fixed z-50 border border-ui-border bg-ui-bg/80 flex flex-col rounded-corner gap-1" :style="overlayStyle">
        <div class="flex items-center gap-2 text-primary font-medium">
          <span>{{ description }}</span>
          <ThemeIcon :name="operationIcon" :size="16" :alt="t('drag.dragging')" />
        </div>
        <div class="font-[11px] text-tx-muted">
          {{ t('drag.holdShiftToChangeMode') }}
          <EntryIconComponent v-for="item in props.dragItems" :entry="item" :size="32" class="fixed z-50" :style="overlayIconStyle" />
          <ThemeIcon
            :name="operationIcon"
            :size="32"
            :alt="t('drag.dragging')"
            class="fixed z-50"
            :style="overlayIconStyle" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.file-browser-drag-overlay-enter-active {
  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out;
}

.file-browser-drag-overlay-leave-active {
  transition:
    opacity 0.2s ease-in,
    transform 0.2s ease-in;
}

.file-browser-drag-overlay-enter-from {
  opacity: 0;
  transform: scale(0.85);
}

.file-browser-drag-overlay-leave-to {
  opacity: 0;
  transform: scale(0.85) translateX(-16px) translateY(-8px);
}
</style>