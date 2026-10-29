<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	FormGroup,
	PasswordField,
	SelectField,
	TextInput,
} from '@vasakgroup/vue-libvasak';
import { computed, nextTick, ref, watch } from 'vue';
import type { ArchiveFormat } from '@/types/file-browser';

const props = defineProps<{
	defaultName: string;
	itemCount: number;
}>();

const emit = defineEmits<{
	confirm: [name: string, format: ArchiveFormat, password?: string];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

const FORMATS: { value: ArchiveFormat; label: string }[] = [
	{ value: 'zip', label: 'ZIP (.zip)' },
	{ value: 'tar.gz', label: 'Gzip (.tar.gz)' },
	{ value: 'tar.xz', label: 'XZ (.tar.xz)' },
	{ value: 'tar.bz2', label: 'Bzip2 (.tar.bz2)' },
	{ value: 'tar.zst', label: 'Zstandard (.tar.zst)' },
	{ value: 'tar', label: 'Tar (.tar)' },
	{ value: 'cpio', label: 'CPIO (.cpio)' },
	{ value: '7z', label: '7-Zip (.7z)' },
];

/**
 * El campo es el `TextInput` de la librería, cuya raíz es el `<input>`: se
 * toma de ahí para seleccionar el nombre al abrir, que la librería no expone.
 */
const field = ref<InstanceType<typeof TextInput> | null>(null);
const inputRef = computed(() => (field.value?.$el as HTMLInputElement | undefined) ?? null);
const name = ref('');
const format = ref<ArchiveFormat>('zip');
const password = ref('');
const isSubmitting = ref(false);

// 7z es el único formato de la lista que cifra.
const canEncrypt = computed(() => format.value === '7z');

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
		password.value = '';
		isSubmitting.value = false;

		nextTick(() => {
			inputRef.value?.focus();
			inputRef.value?.select();
		});
	} else {
		// La clave no se queda en memoria del diálogo al cerrarlo.
		password.value = '';
		emit('cancel');
	}
});

function handleSubmit() {
	if (!isValid.value || isSubmitting.value) return;

	isSubmitting.value = true;
	// Sólo viaja si el formato cifra y se escribió una; sin trim, los espacios cuentan.
	emit(
		'confirm',
		trimmedName.value,
		format.value,
		canEncrypt.value && password.value ? password.value : undefined
	);
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
    <DialogContent size="sm" class="overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>{{ t('dialogs.compressDialog.title') }}</DialogTitle>
      </DialogHeader>

      <div class="flex w-full min-w-0 flex-col gap-4">
        <FormGroup :label="t('name')" html-for="compress-name-input">
          <TextInput id="compress-name-input" ref="field" v-model="name"
            :invalid="Boolean(name) && !isValid" @keydown="handleKeydown" />
        </FormGroup>

        <SelectField
          v-model="format"
          :label="t('dialogs.compressDialog.format')"
          :options="FORMATS" />

        <FormGroup v-if="canEncrypt" :label="t('dialogs.compressDialog.password')" html-for="compress-password-input">
          <PasswordField id="compress-password-input" v-model="password" autocomplete="new-password" revealable
            :placeholder="t('dialogs.compressDialog.passwordHint')" @keydown="handleKeydown" />
        </FormGroup>

        <p class="m-0 truncate text-body-xs text-tx-muted" :title="previewName">
          {{ t('dialogs.compressDialog.summary').replace('{0}', String(props.itemCount)).replace('{1}', previewName) }}
        </p>
      </div>

      <DialogFooter>
        <ActionButton :label="t('dialogs.compressDialog.compress')" :disabled="!isValid" :loading="isSubmitting"
          @click="handleSubmit" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
