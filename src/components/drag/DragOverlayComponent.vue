<script setup lang="ts">
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed } from 'vue';
import { useReactiveIcon } from '@/composables/useReactiveIcon';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import type { DragOperationType } from '@/composables/file-browser/use-file-browser-drag';
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

const copyIcon = useReactiveIcon(() => getIconSource('edit-copy'));
const folderInputIcon = useReactiveIcon(() => getIconSource('folder-open'));

const overlayStyle = computed(() => ({
	left: `${props.cursorX + 16}px`,
	top: `${props.cursorY + 16}px`,
}));

const overlayIconStyle = computed(() => ({
	left: `${props.cursorX - 18}px`,
	top: `${props.cursorY - 18}px`,
}));

const operationIcon = computed(() =>
	props.operationType === 'copy' ? copyIcon.value : folderInputIcon.value
);

const operationLabel = computed(() =>
	props.operationType === 'copy' ? t('drag.copy') : t('drag.move')
);

const description = computed(() => {
	return `${operationLabel.value} ${props.itemCount} ${props.itemCount === 1 ? t('drag.item') : t('drag.items')}`;
});


</script>

<template>
  <Teleport to="body">
    <Transition name="file-browser-drag-overlay">
      <div v-if="props.isActive" class="px-4 py-2 whitespace-nowrap fixed z-50 border border-ui-border bg-ui-bg/80 backdrop-blur-sm flex flex-col rounded-corner gap-1 pointer-events-none" :style="overlayStyle">
        <div class="flex items-center gap-2 text-primary font-medium text-sm">
          <img :src="operationIcon" alt="Drag operation" class="h-4 w-4 flex-shrink-0" />
          <span>{{ description }}</span>
        </div>
        <div class="text-[11px] text-tx-muted">
          {{ t('drag.holdShiftToChangeMode') }}
        </div>
        <div class="fixed z-50 pointer-events-none" :style="overlayIconStyle">
          <EntryIconComponent v-if="props.dragItems.length > 0" :entry="props.dragItems[0]" :size="24" class="h-8 w-8" />
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