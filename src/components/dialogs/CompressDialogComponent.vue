<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, nextTick, ref, watch } from 'vue';
import Dialog from '@/components/ui/dialog/Dialog.vue';
import DialogContent from '@/components/ui/dialog/DialogContent.vue';
import DialogFooter from '@/components/ui/dialog/DialogFooter.vue';
import DialogHeader from '@/components/ui/dialog/DialogHeader.vue';
import DialogTitle from '@/components/ui/dialog/DialogTitle.vue';
import type { ArchiveFormat } from '@/types/file-browser';

const props = defineProps<{
	defaultName: string;
	itemCount: number;
}>();

const emit = defineEmits<{
	confirm: [name: string, format: ArchiveFormat];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

const FORMATS: { value: ArchiveFormat; label: string }[] = [
	{ value: 'zip', label: 'ZIP (.zip)' },
	{ value: 'tar.gz', label: 'Gzip (.tar.gz)' },
	{ value: 'tar.xz', label: 'XZ (.tar.xz)' },
	{ value: 'tar.bz2', label: 'Bzip2 (.tar.bz2)' },
	{ value: 'tar', label: 'Tar (.tar)' },
	{ value: '7z', label: '7-Zip (.7z)' },
];

const inputRef = ref<HTMLInputElement | null>(null);
const name = ref('');
const format = ref<ArchiveFormat>('zip');
const isSubmitting = ref(false);

const trimmedName = computed(() => name.value.trim());

const isValid = computed(() => {
	if (!trimmedName.value) return false;

	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are explicitly rejected
	const invalidChars = /[<>:"/\\|?*\u0000-\u001F]/;

	if (invalidChars.test(trimmedName.value)) return false;

	if (trimmedName.value === '.' || trimmedName.value === '..') return false;

	return true;
});

const previewName = computed(() => `${trimmedName.value || '…'}.${format.value}`);

watch(name, () => {
	if (isSubmitting.value) {
		isSubmitting.value = false;
	}
});

watch(isOpen, (open) => {
	if (open) {
		name.value = props.defaultName;
		isSubmitting.value = false;

		nextTick(() => {
			inputRef.value?.focus();
			inputRef.value?.select();
		});
	} else {
		emit('cancel');
	}
});

function handleSubmit() {
	if (!isValid.value || isSubmitting.value) return;

	isSubmitting.value = true;
	emit('confirm', trimmedName.value, format.value);
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
        <DialogTitle>{{ t('dialogs.compressDialog.title') }}</DialogTitle>
      </DialogHeader>

      <div class="flex w-full min-w-0 flex-col gap-4">
        <div class="flex w-full min-w-0 flex-col gap-2">
          <label for="compress-name-input" class="text-tx-main text-sm font-medium">
            {{ t('name') }}
          </label>
          <input id="compress-name-input" ref="inputRef" v-model="name" type="text"
            class="w-full min-w-0 max-w-full box-border"
            :class="{ '!border-status-error': name && !isValid }" @keydown="handleKeydown" />
        </div>

        <div class="flex w-full min-w-0 flex-col gap-2">
          <label for="compress-format-select" class="text-tx-main text-sm font-medium">
            {{ t('dialogs.compressDialog.format') }}
          </label>
          <select id="compress-format-select" v-model="format"
            class="w-full min-w-0 max-w-full box-border rounded-corner border border-ui-border bg-ui-bg/80 px-2 py-1 text-tx-main">
            <option v-for="option in FORMATS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <p class="truncate text-[12px] text-tx-muted" :title="previewName">
          {{ t('dialogs.compressDialog.summary').replace('{0}', String(props.itemCount)).replace('{1}', previewName) }}
        </p>
      </div>

      <DialogFooter>
        <button type="button" :disabled="!isValid || isSubmitting" @click="handleSubmit">
          {{ t('dialogs.compressDialog.compress') }}
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
