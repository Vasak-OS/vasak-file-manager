<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ThemeIcon } from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
import type { DragOperationType } from '@/composables/file-browser/use-file-browser-drag';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';

const props = defineProps<{
	isActive: boolean;
	itemCount: number;
	operationType: DragOperationType;
	currentDirLocked: boolean;
	targetingEntry: boolean;
}>();

const { t } = useI18n();

const description = computed(() => {
	const base = props.operationType === 'copy' ? 'drag.dropToCopyItems' : 'drag.dropToMoveItems';
	return interpolar(t(claveSegunCantidad(base, props.itemCount)), props.itemCount);
});

// El nombre, no la fuente: ver el comentario del otro velo de arrastre.
const operationIcon = computed(() =>
	props.operationType === 'copy' ? 'edit-copy' : 'folder-open'
);
</script>

<template>
  <Transition name="inbound-drag-overlay">
    <div v-if="isActive && (currentDirLocked || !targetingEntry)" class="inbound-drag-overlay"
      :class="{ 'inbound-drag-overlay--locked': currentDirLocked }">
      <div class="inbound-drag-overlay__card">
        <div class="inbound-drag-overlay__content">
          <span class="inbound-drag-overlay__description">{{ description }}</span>
          <ThemeIcon
            :name="operationIcon"
            type="symbol"
            :size="32"
            :alt="t('drag.dropping')"
            class="inbound-drag-overlay__icon" />
        </div>
        <div class="inbound-drag-overlay__hint">
          {{ t('drag.holdShiftToChangeMode') }}
        </div>
        <div class="inbound-drag-overlay__hint">
          {{ t('drag.holdCtrlForCurrentDirDrop') }}
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.inbound-drag-overlay {
  position: absolute;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed color-mix(in srgb, var(--color-primary) 40%, transparent);
  border-radius: var(--radius-corner-l);
  inset: 0;
  pointer-events: none;
}

.inbound-drag-overlay--locked {
  background-color: color-mix(in srgb, var(--color-primary) 8%, transparent);
}

.inbound-drag-overlay__card {
  display: flex;
  flex-direction: column;
  padding: 8px 16px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-radius: var(--radius-corner-l);
  /* Opaca y sin desenfoque: lo que flota es `ui-float`, y la sombra lleva la
     tinta del esquema (`shadow-surface-l`) en vez de un negro fijo. */
  background-color: var(--color-ui-float);
  box-shadow: var(--shadow-surface-l);
  gap: 4px;
}

.inbound-drag-overlay__content {
  display: flex;
  align-items: center;
  color: var(--color-tx-main);
  font-size: var(--text-label-s);
  font-weight: 500;
  gap: 10px;
}

.inbound-drag-overlay__icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.inbound-drag-overlay__description {
  white-space: nowrap;
}

.inbound-drag-overlay__hint {
  color: var(--color-tx-muted);
  font-size: var(--text-label-xs);
}

.inbound-drag-overlay-enter-active {
  transition:
    opacity 0.2s var(--ease-ui-out),
    transform 0.2s var(--ease-ui-out);
}

.inbound-drag-overlay-leave-active {
  transition:
    opacity 0.15s var(--ease-ui),
    transform 0.15s var(--ease-ui);
}

.inbound-drag-overlay-enter-from {
  opacity: 0;
  transform: scale(0.97);
}

.inbound-drag-overlay-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>