<script setup lang="ts">
import { computed } from 'vue';
import { useOperationsStore, type FileOperation } from '@/stores/runtime/operations';
import { formatBytes } from '@/utils/byte-parser';

const MAX_VISIBLE_OPERATIONS = 10;

const operationsStore = useOperationsStore();

const visibleOperations = computed<FileOperation[]>(() =>
	operationsStore.activeOperations.slice(0, MAX_VISIBLE_OPERATIONS)
);

const hasOperations = computed(() => visibleOperations.value.length > 0);

/**
 * Truncate a file name/path to 60 characters with ellipsis indicator.
 */
function truncateFileName(name: string): string {
	if (name.length <= 60) return name;
	return `${name.slice(0, 57)}...`;
}

/**
 * Format transfer speed in human-readable units (e.g., 1.2 MB/s).
 */
function formatSpeed(bytesPerSecond: number): string {
	if (bytesPerSecond <= 0) return '0 B/s';
	return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Format estimated time remaining in human-readable format.
 */
function formatETA(seconds: number): string {
	if (seconds <= 0 || !Number.isFinite(seconds)) return '--';
	if (seconds < 60) return `${Math.ceil(seconds)}s`;
	if (seconds < 3600) {
		const minutes = Math.floor(seconds / 60);
		const secs = Math.ceil(seconds % 60);
		return `${minutes}m ${secs}s`;
	}
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.ceil((seconds % 3600) / 60);
	return `${hours}h ${minutes}m`;
}

/**
 * Calculate percentage progress from an operation.
 */
function getPercentage(op: FileOperation): number {
	const { totalBytes, transferredBytes, totalFiles, completedFiles } = op.progress;
	if (totalBytes > 0) {
		return Math.min(100, Math.round((transferredBytes / totalBytes) * 100));
	}
	if (totalFiles > 0) {
		return Math.min(100, Math.round((completedFiles / totalFiles) * 100));
	}
	return 0;
}

/**
 * Get a readable label for the operation type.
 */
function getOperationLabel(op: FileOperation): string {
	const labels: Record<string, string> = {
		copy: 'Copying',
		move: 'Moving',
		delete: 'Deleting',
		compress: 'Compressing',
		decompress: 'Decompressing',
	};
	return labels[op.type] ?? op.type;
}

function handleCancel(id: string) {
	operationsStore.cancelOperation(id);
}
</script>

<template>
  <Transition name="tracker-slide">
    <div
      v-if="hasOperations"
      class="fixed bottom-4 right-4 z-50 flex w-[380px] max-h-[420px] flex-col gap-1 rounded-lg border border-ui-border bg-ui-bg/95 shadow-lg backdrop-blur-sm overflow-hidden"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-3 py-2 border-b border-ui-border">
        <span class="text-xs font-medium text-tx-main">
          Operations ({{ visibleOperations.length }})
        </span>
      </div>

      <!-- Operations list -->
      <div class="flex flex-col gap-1 overflow-y-auto p-2">
        <div
          v-for="op in visibleOperations"
          :key="op.id"
          class="flex flex-col gap-1.5 rounded-md border border-ui-border bg-ui-surface/30 px-3 py-2"
        >
          <!-- Operation type and cancel -->
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-medium text-tx-main">
              {{ getOperationLabel(op) }}
            </span>
            <div class="flex items-center gap-2">
              <span class="text-[10px] text-tx-muted tabular-nums">
                {{ getPercentage(op) }}%
              </span>
              <button
                type="button"
                class="inline-flex h-5 w-5 items-center justify-center rounded text-tx-muted hover:bg-status-error/20 hover:text-status-error transition-colors"
                title="Cancel"
                @click="handleCancel(op.id)"
              >
                <svg class="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Progress bar -->
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-ui-surface">
            <div
              class="h-full rounded-full bg-primary transition-all duration-300 ease-out"
              :style="{ width: `${getPercentage(op)}%` }"
            />
          </div>

          <!-- Current file -->
          <div
            v-if="op.progress.currentFile"
            class="text-[10px] text-tx-muted truncate"
            :title="op.progress.currentFile"
          >
            {{ truncateFileName(op.progress.currentFile) }}
          </div>

          <!-- Speed and ETA -->
          <div class="flex items-center justify-between text-[10px] text-tx-muted tabular-nums">
            <span>{{ formatSpeed(op.progress.speed) }}</span>
            <span>
              {{ op.progress.completedFiles }}/{{ op.progress.totalFiles }} files
              <template v-if="op.progress.estimatedTimeRemaining > 0">
                · {{ formatETA(op.progress.estimatedTimeRemaining) }}
              </template>
            </span>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.tracker-slide-enter-active,
.tracker-slide-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.tracker-slide-enter-from,
.tracker-slide-leave-to {
  transform: translateY(16px);
  opacity: 0;
}
</style>
