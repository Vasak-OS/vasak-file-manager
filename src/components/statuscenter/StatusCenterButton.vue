<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	Badge,
	Popover,
	PopoverContent,
	PopoverTrigger,
	ProgressBar,
	SectionHeading,
	StatusDot,
	type StatusDotTone,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import { cancelFileOperation } from '@/stores/runtime/file-operation-runner';
import { type Operation, useStatusCenterStore } from '@/stores/runtime/status-center';

const { t } = useI18n();

const props = withDefaults(
	defineProps<{
		/**
		 * Esconderse mientras no haya nada en curso: en una ventana compacta el
		 * botón quieto le quita lugar a las pestañas, y lo que importa de él es
		 * que avise cuando hay trabajo.
		 */
		hideWhenIdle?: boolean;
	}>(),
	{ hideWhenIdle: false }
);

const statusCenter = useStatusCenterStore();
const dirSizesStore = useDirSizesStore();

const activeCount = computed(() => statusCenter.activeCount);
const hasOperations = computed(() => statusCenter.operationsList.length > 0);
const groups = computed(() => statusCenter.groupedOperations);
const hasCompleted = computed(() => statusCenter.completedOperations.length > 0);

function isActive(op: Operation): boolean {
	return op.status === 'in-progress' || op.status === 'pending';
}

/**
 * El tono del punto de cada operación. Cancelada iba en `amber-500`, un color
 * de la paleta de Tailwind: ahora es el aviso del esquema.
 */
function toneOf(op: Operation): StatusDotTone {
	switch (op.status) {
		case 'in-progress':
			return 'accent';
		case 'completed':
			return 'success';
		case 'cancelled':
			return 'warning';
		case 'error':
			return 'error';
		default:
			return 'neutral';
	}
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
  <Popover v-if="!props.hideWhenIdle || activeCount > 0 || hasOperations">
    <Tooltip>
      <TooltipTrigger>
        <!-- El icono del tema y no un dibujo propio: la rueda mientras hay
             trabajo, el reloj cuando no. El contador va en una insignia. -->
        <span class="relative inline-flex">
          <PopoverTrigger as-child>
            <ActionButton
              label=""
              :icon-alt="t('statusCenter.title')"
              :icon="activeCount > 0 ? 'content-loading-symbolic' : 'document-open-recent'"
              variant="ghost" />
          </PopoverTrigger>
          <Badge
            v-if="activeCount > 0"
            tone="accent"
            variant="solid"
            size="sm"
            class="pointer-events-none absolute -top-1 -right-1"
            :label="activeCount" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ t('statusCenter.title') }}</TooltipContent>
    </Tooltip>
    <PopoverContent side="bottom" align="end" padding="sm" class="w-80 max-h-96" :label="t('statusCenter.title')">
      <div class="flex items-center justify-between gap-2 px-1 pb-2">
        <span class="text-label-m font-semibold text-tx-main">{{ t('statusCenter.title') }}</span>
        <ActionButton
          v-if="hasCompleted"
          :label="t('statusCenter.clearFinished')"
          variant="ghost"
          size="sm"
          @click="statusCenter.clearCompleted()" />
      </div>

      <p v-if="!hasOperations" class="m-0 px-1 py-4 text-center text-body-xs text-tx-muted">
        {{ t('statusCenter.empty') }}
      </p>

      <div v-for="group in groups" :key="group.type" class="mb-2 last:mb-0">
        <SectionHeading :title="group.label" variant="eyebrow" as="h3" class="px-1" />
        <div
          v-for="op in group.operations"
          :key="op.id"
          class="flex flex-col gap-1 rounded-corner-m px-1 py-1.5 transition-colors duration-200 ease-ui hover:bg-ui-hover"
        >
          <div class="flex min-w-0 items-center gap-2">
            <StatusDot :tone="toneOf(op)" :pulse="op.status === 'in-progress'" />
            <span class="min-w-0 flex-1 truncate text-body-xs text-tx-main" :title="op.label">{{ op.label }}</span>
            <span class="shrink-0 text-label-xs tabular-nums text-tx-muted">{{ statusLabel(op) }}</span>
            <ActionButton
              v-if="isActive(op)"
              label=""
              :icon-alt="t('cancel')"
              :title="t('cancel')"
              icon="window-close"
              variant="ghost"
              size="sm"
              @click="cancel(op)" />
          </div>
          <ProgressBar
            v-if="op.status === 'in-progress' && op.progress != null"
            :value="op.progress"
            :label="op.label"
            size="xs" />
          <div v-if="op.message" class="truncate pl-4 text-label-xs text-tx-muted" :title="op.message">{{ op.message }}</div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
