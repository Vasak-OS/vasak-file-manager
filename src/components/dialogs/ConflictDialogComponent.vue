<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	ListRow,
	ThemeIcon,
} from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
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
    <DialogContent size="md" class="overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ThemeIcon name="dialog-warning" type="symbol" :size="20" class="shrink-0 text-status-warning" />
          {{ t('conflictDialog.title') }}
        </DialogTitle>
        <DialogDescription>
          {{ interpolar(t(claveSegunCantidad('conflictDialog.description', conflictCount)), conflictCount) }}
        </DialogDescription>
      </DialogHeader>

      <!-- La barra de desplazamiento la pone `scrollbar.css`. -->
      <div class="max-h-55 overflow-y-auto">
        <div class="flex flex-col gap-0.5 py-1">
          <ListRow
            v-for="conflict in visibleConflicts"
            :key="conflict.source_path"
            :title="conflict.source_name"
            :icon="conflict.source_is_dir ? 'folder' : 'text-x-generic'"
            truncate
            class="bg-ui-surface/40">
            <span class="truncate text-label-m">{{ conflict.source_name }}</span>
            <span v-if="conflict.source_size !== null || conflict.destination_size !== null"
              class="text-body-xs text-tx-muted">
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
            <span v-else-if="conflict.source_is_dir" class="text-body-xs text-tx-muted">
              {{ t('conflictDialog.directory') }}
            </span>
          </ListRow>
          <p v-if="remainingCount > 0" class="m-0 px-3 py-1.5 text-body-s italic text-tx-muted">
            {{ interpolar(t(claveSegunCantidad('conflictDialog.andMore', remainingCount)), remainingCount) }}
          </p>
        </div>
      </div>

      <DialogFooter class="pt-1">
        <div class="flex w-full flex-wrap justify-end gap-1.5">
          <ActionButton :label="t('conflictDialog.skip')" icon="media-skip-forward" variant="secondary" @click="handleSkip" />
          <ActionButton :label="t('conflictDialog.keepBoth')" icon="edit-copy" variant="secondary" @click="handleKeepBoth" />
          <ActionButton :label="t('conflictDialog.replace')" icon="go-jump" @click="handleReplace" />
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
