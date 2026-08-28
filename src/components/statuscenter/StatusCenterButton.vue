<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed } from 'vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import PopoverTrigger from '@/components/ui/popover/PopoverTrigger.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import { cancelFileOperation } from '@/stores/runtime/file-operation-runner';
import { type Operation, useStatusCenterStore } from '@/stores/runtime/status-center';

const { t } = useI18n();

const statusCenter = useStatusCenterStore();
const dirSizesStore = useDirSizesStore();

const activeCount = computed(() => statusCenter.activeCount);
const hasOperations = computed(() => statusCenter.operationsList.length > 0);
const groups = computed(() => statusCenter.groupedOperations);
const hasCompleted = computed(() => statusCenter.completedOperations.length > 0);

function isActive(op: Operation): boolean {
	return op.status === 'in-progress' || op.status === 'pending';
}

function statusLabel(op: Operation): string {
	switch (op.status) {
		case 'in-progress':
			return op.progress != null ? `${op.progress}%` : t('statusCenter.working');
		case 'pending':
			return t('statusCenter.pending');
		case 'completed':
			return t('statusCenter.completed');
		case 'cancelled':
			return t('statusCenter.cancelled');
		case 'error':
			return t('statusCenter.failed');
		default:
			return '';
	}
}

async function cancel(op: Operation) {
	if (op.type === 'dir-size') {
		await dirSizesStore.cancelSize(op.path);
	} else {
		await cancelFileOperation(op.id);
	}
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="relative bg-ui-bg/80 rounded-corner p-1 flex justify-center items-center hover:bg-primary border border-ui-border"
            :class="{ 'bg-primary/15': activeCount > 0 }"
          >
            <svg
              width="24" height="24" viewBox="0 0 24 24" fill="none"
              class="text-primary" :class="{ 'animate-spin': activeCount > 0 }"
              stroke="currentColor" stroke-width="2" stroke-linecap="round"
            >
              <template v-if="activeCount > 0">
                <path d="M12 3a9 9 0 1 0 9 9" />
              </template>
              <template v-else>
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v4l3 2" />
              </template>
            </svg>
            <span
              v-if="activeCount > 0"
              class="absolute -top-1 -right-1 min-w-4 h-4 px-1 flex items-center justify-center text-[10px] font-semibold rounded-full bg-primary text-tx-inverted"
            >{{ activeCount }}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('statusCenter.title') }}</TooltipContent>
      </Tooltip>
    </PopoverTrigger>
    <PopoverContent :side="'bottom'" :align="'end'" class="w-80 p-2 max-h-96 overflow-y-auto">
      <div class="flex items-center justify-between px-1 pb-2">
        <span class="text-[13px] font-semibold text-tx-main">{{ t('statusCenter.title') }}</span>
        <button
          v-if="hasCompleted"
          class="text-[11px] text-tx-muted hover:text-primary"
          @click="statusCenter.clearCompleted()"
        >{{ t('statusCenter.clearFinished') }}</button>
      </div>

      <div v-if="!hasOperations" class="px-1 py-4 text-center text-[12px] text-tx-muted">
        {{ t('statusCenter.empty') }}
      </div>

      <div v-for="group in groups" :key="group.type" class="mb-2 last:mb-0">
        <div class="px-1 text-[11px] font-medium uppercase tracking-wide text-tx-muted">{{ group.label }}</div>
        <div
          v-for="op in group.operations"
          :key="op.id"
          class="flex flex-col gap-1 px-1 py-1.5 rounded-corner hover:bg-ui-surface/60"
        >
          <div class="flex items-center gap-2">
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :class="{
                'bg-primary animate-pulse': op.status === 'in-progress',
                'bg-tx-muted': op.status === 'pending',
                'bg-status-success': op.status === 'completed',
                'bg-amber-500': op.status === 'cancelled',
                'bg-status-error': op.status === 'error',
              }"
            ></span>
            <span class="flex-1 min-w-0 truncate text-[12px] text-tx-main" :title="op.label">{{ op.label }}</span>
            <span class="shrink-0 text-[11px] tabular-nums text-tx-muted">{{ statusLabel(op) }}</span>
            <button
              v-if="isActive(op)"
              class="shrink-0 h-5 w-5 flex items-center justify-center rounded-corner hover:bg-status-error/20 text-tx-muted hover:text-status-error"
              :title="t('cancel')"
              @click="cancel(op)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div
            v-if="op.status === 'in-progress' && op.progress != null"
            class="h-1 w-full overflow-hidden rounded-full bg-ui-surface/40"
          >
            <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${op.progress}%` }"></div>
          </div>
          <div v-if="op.message" class="truncate pl-4 text-[11px] text-tx-muted" :title="op.message">{{ op.message }}</div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
