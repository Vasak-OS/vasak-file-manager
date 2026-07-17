<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ref } from 'vue';
import Dialog from '@/components/ui/dialog/Dialog.vue';
import DialogContent from '@/components/ui/dialog/DialogContent.vue';
import DialogDescription from '@/components/ui/dialog/DialogDescription.vue';
import DialogFooter from '@/components/ui/dialog/DialogFooter.vue';
import DialogHeader from '@/components/ui/dialog/DialogHeader.vue';
import DialogTitle from '@/components/ui/dialog/DialogTitle.vue';

defineProps<{
	archivePath: string;
}>();

const emit = defineEmits<{
	submit: [password: string];
	cancel: [];
}>();

const { t } = useI18n();
const isOpen = defineModel<boolean>('open', { required: true });
const password = ref('');

function handleSubmit() {
	if (password.value.trim()) {
		emit('submit', password.value);
		password.value = '';
		isOpen.value = false;
	}
}

function handleCancel() {
	password.value = '';
	emit('cancel');
	isOpen.value = false;
}

function handleOpenChange(open: boolean) {
	if (!open) {
		handleCancel();
	}
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter') {
		event.preventDefault();
		handleSubmit();
	}
}
</script>

<template>
  <Dialog v-model:open="isOpen" @update:open="handleOpenChange">
    <DialogContent class="w-[420px] max-w-[calc(100vw-32px)] box-border overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>
          {{ t('dialogs.password.title') }}
        </DialogTitle>
        <DialogDescription class="text-muted-foreground text-sm leading-normal">
          {{ t('dialogs.password.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3 py-2">
        <label class="text-sm text-tx-muted" for="archive-password">
          {{ t('dialogs.password.label') }}
        </label>
        <input
          id="archive-password"
          v-model="password"
          type="password"
          class="w-full rounded-md border border-ui-border bg-ui-surface px-3 py-2 text-sm text-tx-main placeholder:text-tx-muted focus:outline-none focus:ring-1 focus:ring-primary"
          :placeholder="t('dialogs.password.placeholder')"
          autofocus
          @keydown="handleKeydown"
        />
      </div>

      <DialogFooter class="pt-1">
        <div class="flex w-full justify-end gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-ui-border px-3 py-1.5 text-sm text-tx-main hover:bg-muted/60"
            @click="handleCancel"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
            :disabled="!password.trim()"
            @click="handleSubmit"
          >
            {{ t('dialogs.password.submit') }}
          </button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
