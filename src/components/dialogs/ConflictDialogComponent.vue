<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	ThemeIcon,
} from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import type { ConflictItem, ConflictResolution } from '@/stores/runtime/clipboard';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';
import toReadableBytes from '@/utils/byte-parser';

const props = defineProps<{
	conflicts: ConflictItem[];
	operationType: 'copy' | 'move';
}>();

const emit = defineEmits<{
	resolve: [resolution: ConflictResolution];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });
const sizeSeparator = ' \u2192 ';
const conflictCount = computed(() => props.conflicts.length);

const visibleConflicts = computed(() => {
	return props.conflicts.slice(0, 5);
});

const remainingCount = computed(() => {
	return Math.max(0, props.conflicts.length - 5);
});

function formatSize(size: number | null): string {
	if (size === null || size === undefined) {
		return '';
	}

	return toReadableBytes(size);
}

function handleReplace() {
	emit('resolve', 'replace');
	isOpen.value = false;
}

function handleSkip() {
	emit('resolve', 'skip');
	isOpen.value = false;
}

function handleKeepBoth() {
	emit('resolve', 'auto-rename');
	isOpen.value = false;
}

function handleCancel() {
	emit('cancel');
	isOpen.value = false;
}

function handleOpenChange(open: boolean) {
	if (!open) {
		handleCancel();
	}
}
</script>

<template>
  <Dialog v-model:open="isOpen" @update:open="handleOpenChange">
    <DialogContent class="w-[520px] max-w-[calc(100vw-32px)] box-border overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ThemeIcon name="dialog-warning" type="symbol" :size="20" class="shrink-0 text-status-warning" />
          {{ t('conflictDialog.title') }}
        </DialogTitle>
        <DialogDescription class="text-tx-muted text-sm leading-normal">
          {{ interpolar(t(claveSegunCantidad('conflictDialog.description', conflictCount)), conflictCount) }}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea class="max-h-[220px]">
        <div class="flex flex-col py-1 gap-0.5">
          <div v-for="conflict in visibleConflicts" :key="conflict.source_path" class="flex items-center px-3 py-2 rounded-corner bg-ui-surface/40 gap-2.5">
            <ThemeIcon
              :name="conflict.source_is_dir ? 'folder' : 'text-x-generic'"
              :size="16"
              class="text-tx-muted" />
            <div class="flex min-w-0 flex-col gap-0.5">
              <span class="overflow-hidden text-tx-main text-[13px] font-medium text-ellipsis whitespace-nowrap">{{ conflict.source_name }}</span>
              <span v-if="conflict.source_size !== null || conflict.destination_size !== null"
                class="text-tx-muted text-xs">
                <template v-if="conflict.source_size !== null">
                  {{ interpolar(t('conflictDialog.sourceSize'), formatSize(conflict.source_size)) }}
                </template>
                <span v-if="conflict.source_size !== null && conflict.destination_size !== null">
                  {{ sizeSeparator }}
                </span>
                <template v-if="conflict.destination_size !== null">
                  {{ interpolar(t('conflictDialog.destinationSize'), formatSize(conflict.destination_size)) }}
                </template>
              </span>
              <span v-else-if="conflict.source_is_dir" class="text-tx-muted text-xs">
                {{ t('conflictDialog.directory') }}
              </span>
            </div>
          </div>
          <div v-if="remainingCount > 0" class="px-3 py-1.5 text-tx-muted text-[13px] italic">
            {{ interpolar(t(claveSegunCantidad('conflictDialog.andMore', remainingCount)), remainingCount) }}
          </div>
        </div>
      </ScrollArea>

      <DialogFooter class="pt-1">
        <div class="flex w-full flex-wrap justify-end gap-1.5">
          <button type="button" class="inline-flex items-center gap-1.5" @click="handleSkip">
            <ThemeIcon name="media-skip-forward" type="symbol" :size="14" class="shrink-0" />
            {{ t('conflictDialog.skip') }}
          </button>
          <button type="button" class="inline-flex items-center gap-1.5" @click="handleKeepBoth">
            <ThemeIcon name="edit-copy" type="symbol" :size="14" class="shrink-0" />
            {{ t('conflictDialog.keepBoth') }}
          </button>
          <button type="button" class="inline-flex items-center gap-1.5" @click="handleReplace">
            <ThemeIcon name="go-jump" type="symbol" :size="14" class="shrink-0" />
            {{ t('conflictDialog.replace') }}
          </button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
