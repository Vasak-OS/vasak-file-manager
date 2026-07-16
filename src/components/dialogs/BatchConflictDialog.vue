<script setup lang="ts">
import { getSymbolSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ref } from 'vue';
import { useReactiveIcon } from '@/composables/useReactiveIcon';
import Dialog from '@/components/ui/dialog/Dialog.vue';
import DialogContent from '@/components/ui/dialog/DialogContent.vue';
import DialogDescription from '@/components/ui/dialog/DialogDescription.vue';
import DialogFooter from '@/components/ui/dialog/DialogFooter.vue';
import DialogHeader from '@/components/ui/dialog/DialogHeader.vue';
import DialogTitle from '@/components/ui/dialog/DialogTitle.vue';
import type { BatchConflict, ConflictResolutionChoice } from '@/composables/use-batch-operations';

const props = defineProps<{
	conflict: BatchConflict | null;
}>();

const emit = defineEmits<{
	resolve: [choice: ConflictResolutionChoice, applyToAll: boolean];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

const AlertTriangleIcon = useReactiveIcon(() => getSymbolSource('dialog-warning'));

const applyToAll = ref(false);
const renameValue = ref('');
const showRenameInput = ref(false);

function handleSkip() {
	emit('resolve', 'skip', applyToAll.value);
	resetState();
}

function handleOverwrite() {
	emit('resolve', 'overwrite', applyToAll.value);
	resetState();
}

function handleRename() {
	if (!showRenameInput.value) {
		// Show rename input first
		showRenameInput.value = true;
		renameValue.value = props.conflict?.sourceName ?? '';
		return;
	}

	// Confirm rename
	emit('resolve', 'rename', applyToAll.value);
	resetState();
}

function handleCancel() {
	emit('cancel');
	resetState();
}

function resetState() {
	isOpen.value = false;
	applyToAll.value = false;
	renameValue.value = '';
	showRenameInput.value = false;
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
          {{ t('batchConflict.title') }}
        </DialogTitle>
        <DialogDescription class="text-muted-foreground text-sm leading-normal">
          {{ t('batchConflict.description') }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="conflict" class="flex flex-col gap-3 py-2">
        <!-- Conflicting file info -->
        <div class="flex flex-col gap-1 px-3 py-2 rounded-md bg-muted/40">
          <span class="text-foreground text-[13px] font-medium break-all">
            {{ conflict.sourceName }}
          </span>
          <span class="text-muted-foreground text-xs break-all">
            {{ `→ ${conflict.destinationPath}` }}
          </span>
        </div>

        <!-- Rename input (shown when user clicks Rename) -->
        <div v-if="showRenameInput" class="flex flex-col gap-1.5 px-1">
          <label for="rename-input" class="text-foreground text-xs font-medium">
            {{ t('batchConflict.newName') }}
          </label>
          <input
            id="rename-input"
            v-model="renameValue"
            type="text"
            class="w-full min-w-0 max-w-full box-border text-sm px-2 py-1 rounded-md border border-ui-border bg-ui-bg"
            @keydown.enter="handleRename"
          />
        </div>

        <!-- Apply to all checkbox -->
        <label class="flex items-center gap-2 px-1 cursor-pointer select-none">
          <input
            v-model="applyToAll"
            type="checkbox"
            class="w-4 h-4 rounded border-ui-border"
          />
          <span class="text-foreground text-[13px]">
            {{ t('batchConflict.applyToAll') }}
          </span>
        </label>
      </div>

      <DialogFooter class="pt-2">
        <div class="flex w-full flex-wrap justify-end gap-1.5">
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-md border border-ui-border hover:bg-muted/60 transition-colors"
            @click="handleSkip"
          >
            {{ t('batchConflict.skip') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-md border border-ui-border hover:bg-muted/60 transition-colors"
            @click="handleOverwrite"
          >
            {{ t('batchConflict.overwrite') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-md border border-ui-border hover:bg-muted/60 transition-colors"
            @click="handleRename"
          >
            {{ t('batchConflict.rename') }}
          </button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
