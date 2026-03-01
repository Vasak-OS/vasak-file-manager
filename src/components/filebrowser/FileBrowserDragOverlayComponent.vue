<script setup lang="ts">
import { computed, onMounted, ref  } from 'vue';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import type { DragOperationType } from '@/composables/file-browser/use-file-browser-drag';
import { getSymbolSource } from '@vasakgroup/plugin-vicons';

const props = defineProps<{
	isActive: boolean;
	itemCount: number;
	operationType: DragOperationType;
	cursorX: number;
	cursorY: number;
}>();

const { t } = useI18n();

const CopyIcon = ref('');
const FolderInputIcon = ref('');

const overlayStyle = computed(() => ({
	left: `${props.cursorX + 16}px`,
	top: `${props.cursorY + 16}px`,
}));

const description = computed(() => {
	if (props.operationType === 'copy') {
		return `drag.copyItems ${props.itemCount}`;
	}

	return `drag.moveItems ${props.itemCount}`;
});

onMounted(async () => {
  CopyIcon.value = await getSymbolSource('edit-copy');
  FolderInputIcon.value = await getSymbolSource('folder-open');
});
</script>

<template>
  <Teleport to="body">
    <Transition name="file-browser-drag-overlay">
      <div v-if="props.isActive" class="file-browser-drag-overlay" :style="overlayStyle">
        <div class="file-browser-drag-overlay__content">
          <span class="file-browser-drag-overlay__description">{{ description }}</span>
          <component :is="props.operationType === 'copy' ? CopyIcon : FolderInputIcon" :size="16"
            class="file-browser-drag-overlay__icon" />
        </div>
        <div class="file-browser-drag-overlay__hint">
          {{ t('drag.holdShiftToChangeMode') }}
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.file-browser-drag-overlay {
  position: fixed;
  z-index: 90;
  display: flex;
  flex-direction: column;
  padding: 8px 16px;
  border: 1px solid hsl(var(--primary) / 30%);
  border-radius: var(--radius-md);
  backdrop-filter: blur(12px);
  background-color: hsl(var(--background) / 80%);
  box-shadow:
    0 8px 32px hsl(0deg 0% 0% / 25%),
    0 2px 8px hsl(0deg 0% 0% / 10%);
  gap: 4px;
  pointer-events: none;
  white-space: nowrap;
}

.file-browser-drag-overlay__content {
  display: flex;
  align-items: center;
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 500;
  gap: 10px;
}

.file-browser-drag-overlay__icon {
  flex-shrink: 0;
  color: hsl(var(--primary));
}

.file-browser-drag-overlay__hint {
  color: hsl(var(--muted-foreground));
  font-size: 11px;
}

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