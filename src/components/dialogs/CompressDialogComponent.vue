<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import Dialog from '@/components/ui/dialog/Dialog.vue';
import DialogContent from '@/components/ui/dialog/DialogContent.vue';
import DialogFooter from '@/components/ui/dialog/DialogFooter.vue';
import DialogHeader from '@/components/ui/dialog/DialogHeader.vue';
import DialogTitle from '@/components/ui/dialog/DialogTitle.vue';

export type CompressionFormat = 'zip' | 'tar.gz' | '7z';

const props = defineProps<{
	defaultName: string;
	entryCount: number;
}>();

const emit = defineEmits<{
	confirm: [options: { name: string; format: CompressionFormat }];
	cancel: [];
}>();

const isOpen = defineModel<boolean>('open', { required: true });

const inputRef = ref<HTMLInputElement | null>(null);
const name = ref('');
const format = ref<CompressionFormat>('zip');
const isSubmitting = ref(false);

const MAX_NAME_LENGTH = 255;

const formats: { value: CompressionFormat; label: string }[] = [
	{ value: 'zip', label: 'ZIP (.zip)' },
	{ value: 'tar.gz', label: 'TAR.GZ (.tar.gz)' },
	{ value: '7z', label: '7Z (.7z)' },
];

const trimmedName = computed(() => name.value.trim());

const isValid = computed(() => {
	if (!trimmedName.value) return false;
	if (trimmedName.value.length > MAX_NAME_LENGTH) return false;

	// biome-ignore lint/suspicious/noControlCharactersInRegex: we explicitly want to match null character and other control characters
	const invalidChars = /[<>:"/\\|?*\u0000-\u001F]/;
	if (invalidChars.test(trimmedName.value)) return false;

	if (trimmedName.value === '.' || trimmedName.value === '..') return false;

	return true;
});

const charCount = computed(() => trimmedName.value.length);

watch(isOpen, (open) => {
	if (open) {
		name.value = props.defaultName;
		format.value = 'zip';
		isSubmitting.value = false;

		nextTick(() => {
			inputRef.value?.focus();
			inputRef.value?.select();
		});
	} else {
		handleCancel();
	}
});

function handleSubmit() {
	if (!isValid.value || isSubmitting.value) return;

	isSubmitting.value = true;
	emit('confirm', { name: trimmedName.value, format: format.value });
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
    <DialogContent class="w-[460px] max-w-[calc(100vw-32px)] box-border overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>Comprimir {{ entryCount }} {{ entryCount === 1 ? 'elemento' : 'elementos' }}</DialogTitle>
      </DialogHeader>

      <div class="flex w-full min-w-0 flex-col gap-4">
        <!-- Format selector -->
        <div class="flex w-full min-w-0 flex-col gap-2">
          <label for="compress-format" class="text-foreground text-sm font-medium">
            Formato
          </label>
          <select
            id="compress-format"
            v-model="format"
            class="w-full min-w-0 max-w-full box-border rounded-corner border border-ui-border bg-ui-bg px-3 py-2 text-sm text-tx-main"
          >
            <option v-for="f in formats" :key="f.value" :value="f.value">
              {{ f.label }}
            </option>
          </select>
        </div>

        <!-- Output filename -->
        <div class="flex w-full min-w-0 flex-col gap-2">
          <label for="compress-name" class="text-foreground text-sm font-medium">
            Nombre del archivo
          </label>
          <input
            id="compress-name"
            ref="inputRef"
            v-model="name"
            type="text"
            :maxlength="MAX_NAME_LENGTH"
            class="w-full min-w-0 max-w-full box-border"
            :class="{ '!border-destructive': name && !isValid }"
            @keydown="handleKeydown"
          />
          <div class="flex items-center justify-between text-xs text-tx-muted">
            <span v-if="name && !isValid" class="text-destructive">
              Nombre no válido
            </span>
            <span v-else />
            <span :class="{ 'text-destructive': charCount > MAX_NAME_LENGTH }">
              {{ charCount }}/{{ MAX_NAME_LENGTH }}
            </span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            class="px-4 py-2 text-sm rounded-corner border border-ui-border bg-transparent text-tx-main hover:bg-muted/60"
            @click="handleCancel"
          >
            Cancelar
          </button>
          <button
            type="button"
            :disabled="!isValid || isSubmitting"
            class="px-4 py-2 text-sm rounded-corner bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleSubmit"
          >
            Comprimir
          </button>
        </div>
      </div>

      <DialogFooter />
    </DialogContent>
  </Dialog>
</template>
