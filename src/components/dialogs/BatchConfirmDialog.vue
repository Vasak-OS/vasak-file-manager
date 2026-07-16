<script setup lang="ts">
import { getSymbolSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed } from 'vue';
import { useReactiveIcon } from '@/composables/useReactiveIcon';
import Dialog from '@/components/ui/dialog/Dialog.vue';
import DialogContent from '@/components/ui/dialog/DialogContent.vue';
import DialogDescription from '@/components/ui/dialog/DialogDescription.vue';
import DialogFooter from '@/components/ui/dialog/DialogFooter.vue';
import DialogHeader from '@/components/ui/dialog/DialogHeader.vue';
import DialogTitle from '@/components/ui/dialog/DialogTitle.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import type { DirEntry } from '@/types/dir-entry';
import type { BatchOperationType } from '@/composables/use-batch-operations';

const props = defineProps<{
	operationType: BatchOperationType;
	entries: DirEntry[];
	destination?: string;
}>();

const emit = defineEmits<{
	confirm: [];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

const AlertTriangleIcon = useReactiveIcon(() => getSymbolSource('dialog-warning'));

const operationLabel = computed(() => {
	switch (props.operationType) {
		case 'delete':
			return t('batchConfirm.operationDelete');
		case 'move':
			return t('batchConfirm.operationMove');
		case 'copy':
			return t('batchConfirm.operationCopy');
		case 'compress':
			return t('batchConfirm.operationCompress');
		case 'changePermissions':
			return t('batchConfirm.operationChangePermissions');
		default:
			return props.operationType;
	}
});

const entryCount = computed(() => props.entries.length);

const previewEntries = computed(() => props.entries.slice(0, 5));

const remainingCount = computed(() => Math.max(0, props.entries.length - 5));

function handleConfirm() {
	emit('confirm');
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
    <DialogContent class="w-[480px] max-w-[calc(100vw-32px)] box-border overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <img :src="AlertTriangleIcon" class="w-5 h-5 shrink-0" alt="" />
          {{ t('batchConfirm.title') }}
        </DialogTitle>
        <DialogDescription class="text-muted-foreground text-sm leading-normal">
          {{ `${operationLabel} — ${entryCount} ${t('batchConfirm.elements')}` }}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea class="max-h-[180px]">
        <div class="flex flex-col py-1 gap-0.5">
          <div
            v-for="entry in previewEntries"
            :key="entry.path"
            class="flex items-center px-3 py-1.5 rounded-md bg-muted/40 gap-2"
          >
            <span class="text-muted-foreground text-xs">
              {{ entry.is_dir ? '📁' : '📄' }}
            </span>
            <span class="overflow-hidden text-foreground text-[13px] text-ellipsis whitespace-nowrap">
              {{ entry.name }}
            </span>
          </div>
          <div v-if="remainingCount > 0" class="px-3 py-1.5 text-muted-foreground text-[13px] italic">
            {{ `${t('batchConfirm.andMore')} ${remainingCount}` }}
          </div>
        </div>
      </ScrollArea>

      <div v-if="destination" class="text-muted-foreground text-xs px-1">
        {{ `${t('batchConfirm.destination')}: ${destination}` }}
      </div>

      <DialogFooter class="pt-2">
        <div class="flex w-full justify-end gap-2">
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-md border border-ui-border hover:bg-muted/60 transition-colors"
            @click="handleCancel"
          >
            {{ t('cancel') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            @click="handleConfirm"
          >
            {{ t('batchConfirm.confirm') }}
          </button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
