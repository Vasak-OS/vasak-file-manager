<script lang="ts" setup>
import { computed } from 'vue';

interface ToastData {
	id: string | number;
	title: string;
	description: string;
	progress: number;
	actionText: string;
	cleanup: () => void;
	operationType: 'copy' | 'move' | 'delete' | '';
	itemCount: number;
}

interface Props {
	data: ToastData;
	onAction: () => void;
}

const props = defineProps<Props>();

const displayProgress = computed(() => Math.round(props.data.progress));
const isComplete = computed(() => displayProgress.value >= 100);

const operationLabel = computed(() => {
	switch (props.data.operationType) {
		case 'copy':
			return 'Copiando';
		case 'move':
			return 'Moviendo';
		case 'delete':
			return 'Eliminando';
		default:
			return '';
	}
});

const progressColor = computed(() => {
	if (displayProgress.value < 50) return 'bg-blue-500';
	if (displayProgress.value < 80) return 'bg-cyan-500';
	return 'bg-green-500';
});
</script>

<template>
  <div class="flex flex-col gap-3 w-full max-w-md p-4 rounded-corner bg-ui-bg/80 border border-ui-border">
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <div class="flex-1 min-w-0">
        <h3 class="font-semibold text-sm text-tx-main truncate">{{ data.title }}</h3>
        <p v-if="data.description" class="text-xs text-tx-muted mt-1">{{ data.description }}</p>
      </div>
      <button v-if="!isComplete" @click="onAction" class="px-2 py-1 text-xs font-medium text-tx-muted hover:text-tx-main transition-colors flex-shrink-0">
        {{ data.actionText }}
      </button>
    </div>

    <!-- Progress Bar -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between text-xs text-tx-muted">
        <span>{{ operationLabel }} {{ data.itemCount }} {{ data.itemCount === 1 ? 'archivo' : 'archivos' }}</span>
        <span class="font-medium">{{ displayProgress }}%</span>
      </div>
      <div class="w-full h-2 bg-ui-surface rounded-full overflow-hidden">
        <div
          :class="[progressColor, 'h-full transition-all duration-300']"
          :style="{ width: `${displayProgress}%` }"
        />
      </div>
    </div>

    <!-- Complete State -->
    <div v-if="isComplete" class="flex items-center justify-between pt-2 border-t border-ui-border">
      <span class="text-xs text-status-success">✓ Completado</span>
      <button @click="onAction" class="px-2 py-1 text-xs font-medium text-tx-muted hover:text-tx-main transition-colors">
        {{ data.actionText }}
      </button>
    </div>
  </div>
</template>


