<script lang="ts" setup>
import { computed } from 'vue';
import type { FileOperationType } from '@/stores/runtime/operations';

interface Props {
	operationType: FileOperationType;
	destinationPath?: string;
	successCount?: number;
	failedCount?: number;
	skippedCount?: number;
	isPartialFailure?: boolean;
	onClick?: () => void;
}

const props = defineProps<Props>();

const operationLabel = computed(() => {
	const labels: Record<FileOperationType, string> = {
		copy: 'Copia',
		move: 'Movimiento',
		delete: 'Eliminación',
		compress: 'Compresión',
		decompress: 'Descompresión',
	};
	return labels[props.operationType] ?? props.operationType;
});

const title = computed(() => {
	if (props.isPartialFailure) {
		return `${operationLabel.value} completada parcialmente`;
	}
	return `${operationLabel.value} completada`;
});

const summary = computed(() => {
	if (!props.isPartialFailure) return null;
	const parts: string[] = [];
	if (props.successCount && props.successCount > 0) {
		parts.push(`${props.successCount} exitosos`);
	}
	if (props.failedCount && props.failedCount > 0) {
		parts.push(`${props.failedCount} fallidos`);
	}
	if (props.skippedCount && props.skippedCount > 0) {
		parts.push(`${props.skippedCount} omitidos`);
	}
	return parts.join(', ');
});

const isClickable = computed(() => !!props.destinationPath && !!props.onClick);

function handleClick() {
	if (isClickable.value && props.onClick) {
		props.onClick();
	}
}
</script>

<template>
  <div
    :class="[
      'flex items-start gap-3 w-full max-w-md p-4 rounded-corner border',
      isPartialFailure
        ? 'bg-ui-bg/80 border-status-warning/40'
        : 'bg-ui-bg/80 border-ui-border',
      isClickable ? 'cursor-pointer hover:bg-ui-surface/60 transition-colors' : ''
    ]"
    :role="isClickable ? 'button' : undefined"
    :tabindex="isClickable ? 0 : undefined"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
  >
    <!-- Icon -->
    <div
      :class="[
        'flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5',
        isPartialFailure ? 'bg-status-warning/20' : 'bg-status-success/20'
      ]"
    >
      <svg
        v-if="!isPartialFailure"
        class="w-3 h-3 text-status-success"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
      <svg
        v-else
        class="w-3 h-3 text-status-warning"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5Z" />
      </svg>
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <h3 class="font-semibold text-sm text-tx-main">{{ title }}</h3>
      <p v-if="summary" class="text-xs text-tx-muted mt-1">{{ summary }}</p>
      <p v-if="isClickable" class="text-[10px] text-tx-muted mt-1 opacity-70">
        Clic para navegar al destino
      </p>
    </div>
  </div>
</template>
