<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, nextTick, ref, watch } from 'vue';
import Dialog from '@/components/ui/dialog/Dialog.vue';
import DialogContent from '@/components/ui/dialog/DialogContent.vue';
import DialogFooter from '@/components/ui/dialog/DialogFooter.vue';
import DialogHeader from '@/components/ui/dialog/DialogHeader.vue';
import DialogTitle from '@/components/ui/dialog/DialogTitle.vue';

const props = defineProps<{
	type: 'directory' | 'file';
}>();

const emit = defineEmits<{
	confirm: [name: string];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

const inputRef = ref<HTMLInputElement | null>(null);
const name = ref('');
const isSubmitting = ref(false);

const dialogTitle = computed(() => {
	return t(
		props.type === 'directory'
			? 'dialogs.newItemDialog.newDirectory'
			: 'dialogs.newItemDialog.newFile'
	);
});

const trimmedName = computed(() => name.value.trim());

const isValid = computed(() => {
	if (!trimmedName.value) return false;

	// biome-ignore lint/suspicious/noControlCharactersInRegex: we explicitly want to match null character and other control characters
	const invalidChars = /[<>:"/\\|?*\u0000-\u001F]/;

	if (invalidChars.test(trimmedName.value)) return false;

	if (trimmedName.value === '.' || trimmedName.value === '..') return false;

	return true;
});

watch(name, () => {
	if (isSubmitting.value) {
		isSubmitting.value = false;
	}
});

watch(isOpen, (open) => {
	if (open) {
		name.value = '';
		isSubmitting.value = false;

		nextTick(() => {
			inputRef.value?.focus();
		});
	} else {
		handleCancel();
	}
});

async function handleSubmit() {
	if (!isValid.value || isSubmitting.value) return;

	isSubmitting.value = true;
	emit('confirm', trimmedName.value);
}

function handleCancel() {
	emit('cancel');
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter' && isValid.value) {
		event.preventDefault();
		handleSubmit();
	}
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="w-[420px] max-w-[calc(100vw-32px)] box-border overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
      </DialogHeader>

      <div class="flex w-full min-w-0 flex-col gap-4">
        <div class="flex w-full min-w-0 flex-col gap-2">
          <label for="new-item-input" class="text-foreground text-sm font-medium">
            {{ t('name') }}
          </label>
          <div class="flex w-full min-w-0 items-center gap-2">
            <input id="new-item-input" ref="inputRef" v-model="name" type="text"
              class="w-full min-w-0 max-w-full box-border"
              :class="{ '!border-destructive': name && !isValid }" @keydown="handleKeydown" />
            <button type="button" :disabled="!isValid || isSubmitting" @click="handleSubmit">
              {{ t('create') }}
            </button>
          </div>
        </div>
      </div>

      <DialogFooter />
    </DialogContent>
  </Dialog>
</template>
