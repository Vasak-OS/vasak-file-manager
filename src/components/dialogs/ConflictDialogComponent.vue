<script setup lang="ts">
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, onMounted, ref } from 'vue';
import Dialog from '@/components/ui/dialog/Dialog.vue';
import DialogContent from '@/components/ui/dialog/DialogContent.vue';
import DialogDescription from '@/components/ui/dialog/DialogDescription.vue';
import DialogFooter from '@/components/ui/dialog/DialogFooter.vue';
import DialogHeader from '@/components/ui/dialog/DialogHeader.vue';
import DialogTitle from '@/components/ui/dialog/DialogTitle.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import type { ConflictItem, ConflictResolution } from '@/stores/runtime/clipboard';
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
const FolderIcon = ref('');
const FileIcon = ref('');

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

onMounted(async () => {
	FolderIcon.value = await getIconSource('folder');
	FileIcon.value = await getIconSource('application-rtf');
});
</script>

<template>
  <Dialog v-model:open="isOpen" @update:open="handleOpenChange">
    <DialogContent class="w-[520px] max-w-[calc(100vw-32px)] box-border overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <AlertTriangleIcon class="w-5 h-5 shrink-0 text-warning" />
          {{ t('conflictDialog.title') }}
        </DialogTitle>
        <DialogDescription class="text-muted-foreground text-sm leading-normal">
          {{ `conflictDialog.description ${conflictCount}` }}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea class="max-h-[220px]">
        <div class="flex flex-col py-1 gap-0.5">
          <div v-for="conflict in visibleConflicts" :key="conflict.source_path" class="flex items-center px-3 py-2 rounded-md bg-muted/40 gap-2.5">
            <component :is="conflict.source_is_dir ? FolderIcon : FileIcon" class="w-4 h-4 shrink-0 text-muted-foreground" />
            <div class="flex min-w-0 flex-col gap-0.5">
              <span class="overflow-hidden text-foreground text-[13px] font-medium text-ellipsis whitespace-nowrap">{{ conflict.source_name }}</span>
              <span v-if="conflict.source_size !== null || conflict.destination_size !== null"
                class="text-muted-foreground text-xs">
                <template v-if="conflict.source_size !== null">
                  {{ `conflictDialog.sourceSize ${formatSize(conflict.source_size)}` }}
                </template>
                <span v-if="conflict.source_size !== null && conflict.destination_size !== null">
                  {{ sizeSeparator }}
                </span>
                <template v-if="conflict.destination_size !== null">
                  {{ `conflictDialog.destinationSize ${formatSize(conflict.destination_size)}` }}
                </template>
              </span>
              <span v-else-if="conflict.source_is_dir" class="text-muted-foreground text-xs">
                'directory'
              </span>
            </div>
          </div>
          <div v-if="remainingCount > 0" class="px-3 py-1.5 text-muted-foreground text-[13px] italic">
            {{ `conflictDialog.andMore ${remainingCount}` }}
          </div>
        </div>
      </ScrollArea>

      <DialogFooter class="pt-1">
        <div class="flex w-full flex-wrap justify-end gap-1.5">
          <button type="button" class="inline-flex items-center gap-1.5" @click="handleSkip">
            <SkipForwardIcon class="w-3.5 h-3.5 shrink-0" />
            {{ t('conflictDialog.skip') }}
          </button>
          <button type="button" class="inline-flex items-center gap-1.5" @click="handleKeepBoth">
            <CopyPlusIcon class="w-3.5 h-3.5 shrink-0" />
            {{ t('conflictDialog.keepBoth') }}
          </button>
          <button type="button" class="inline-flex items-center gap-1.5" @click="handleReplace">
            <ArrowRightLeftIcon class="w-3.5 h-3.5 shrink-0" />
            {{ t('conflictDialog.replace') }}
          </button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
