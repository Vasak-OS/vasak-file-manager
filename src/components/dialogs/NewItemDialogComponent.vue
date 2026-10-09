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
	TextInput,
} from '@vasakgroup/vue-libvasak';
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps<{
	type: 'directory' | 'file';
}>();

const emit = defineEmits<{
	confirm: [name: string];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

/**
 * El campo es el `TextInput` de la librería, cuya raíz es el `<input>`: se
 * toma de ahí para seleccionar el nombre al abrir, que la librería no expone.
 */
const field = ref<InstanceType<typeof TextInput> | null>(null);
const inputRef = computed(() => (field.value?.$el as HTMLInputElement | undefined) ?? null);
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
    <DialogContent size="sm" class="overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}</DialogTitle>
      </DialogHeader>

      <div class="flex w-full min-w-0 flex-col gap-4">
        <FormGroup :label="t('name')" html-for="new-item-input">
          <div class="flex w-full min-w-0 items-center gap-2">
            <TextInput id="new-item-input" ref="field" v-model="name" class="min-w-0 flex-1"
              :invalid="Boolean(name) && !isValid" @keydown="handleKeydown" />
            <ActionButton :label="t('create')" :disabled="!isValid" :loading="isSubmitting" @click="handleSubmit" />
          </div>
        </FormGroup>
      </div>

      <DialogFooter />
    </DialogContent>
  </Dialog>
</template>
