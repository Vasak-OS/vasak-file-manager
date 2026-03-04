<script setup lang="ts">
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, onMounted, ref } from 'vue';
import type { DragOperationType } from '@/composables/file-browser/use-file-browser-drag';
import type { DirEntry } from '@/types/dir-entry';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';

const props = defineProps<{
	isActive: boolean;
	itemCount: number;
	operationType: DragOperationType;
	cursorX: number;
	cursorY: number;
	dragItems?: DirEntry[];
}>();

const { t } = useI18n();

const copyIcon = ref('');
const folderInputIcon = ref('');

const overlayStyle = computed(() => ({
	left: `${props.cursorX + 16}px`,
	top: `${props.cursorY + 16}px`,
}));

const overlayIconStyle = computed(() => ({
  left: `${props.cursorX - 18 }px`,
  top: `${props.cursorY - 18 }px`,
}));

const operationIcon = computed(() =>
  props.operationType === 'copy' ? copyIcon.value : folderInputIcon.value
);

const description = computed(() => {
	if (props.operationType === 'copy') {
		return `drag.copyItems ${props.itemCount}`;
	}

	return `drag.moveItems ${props.itemCount}`;
});

onMounted(async () => {
	copyIcon.value = await getIconSource('edit-copy');
	folderInputIcon.value = await getIconSource('folder-open');
});
</script>

<template>
  <Teleport to="body">
    <Transition name="file-browser-drag-overlay">
      <div v-if="props.isActive" class="px-4 py-2 whitespace-nowrap fixed z-50 border border-ui-border bg-ui-bg/80 flex flex-col rounded-corner gap-1" :style="overlayStyle">
        <div class="flex items-center gap-2 text-primary font-medium">
          <span>{{ description }}</span>
          <img :src="operationIcon" alt="Drag operation" class="h-4 w-4" />
        </div>
        <div class="font-[11px] text-tx-muted">
          {{ t('drag.holdShiftToChangeMode') }}
          <EntryIconComponent
            v-for="item in props.dragItems"
            :key="item.path"
            :entry="item"
            :size="24"
            class="h-8 w-8 fixed z-50"
            :style="overlayIconStyle"
          />
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