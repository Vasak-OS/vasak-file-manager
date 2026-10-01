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
import type { DirEntry } from '@/types/dir-entry';

const props = defineProps<{
	entry: DirEntry | null;
}>();

const emit = defineEmits<{
	confirm: [newName: string];
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
const newName = ref('');
const isSubmitting = ref(false);

function getNameWithoutExtension(name: string): string {
	const lastDotIndex = name.lastIndexOf('.');

	if (lastDotIndex > 0) {
		return name.substring(0, lastDotIndex);
	}

	return name;
}

const fullNewName = computed(() => {
	return newName.value.trim();
});

const hasChanges = computed(() => {
	if (!props.entry) return false;
	return fullNewName.value !== props.entry.name;
});

const isValid = computed(() => {
	const trimmed = newName.value.trim();

	if (!trimmed) return false;

	// biome-ignore lint/suspicious/noControlCharactersInRegex: we explicitly want to match null character and other control characters
	const invalidChars = /[<>:"/\\|?*\u0000-\u001F]/;

	if (invalidChars.test(trimmed)) return false;

	if (trimmed === '.' || trimmed === '..') return false;

	return true;
});

watch(newName, () => {
	if (isSubmitting.value) {
		isSubmitting.value = false;
	}
});

watch(isOpen, (open) => {
	if (open && props.entry) {
		const entry = props.entry;
		newName.value = entry.name;
		isSubmitting.value = false;

		nextTick(() => {
			if (inputRef.value) {
				const inputElement = inputRef.value;
				inputElement.blur();

				if (entry.is_dir) {
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							inputElement.focus();
							inputElement.select();
						});
					});
				} else {
					const nameWithoutExt = getNameWithoutExtension(entry.name);
					const selectionStart = 0;
					const selectionEnd = nameWithoutExt.length;

					requestAnimationFrame(() => {
						inputElement.focus();

						requestAnimationFrame(() => {
							inputElement.setSelectionRange(selectionStart, selectionEnd);
						});
					});
				}
			}
		});
	} else if (!open) {
		handleCancel();
	}
});

async function handleSubmit() {
	if (!isValid.value || !hasChanges.value || isSubmitting.value) return;

	isSubmitting.value = true;
	emit('confirm', fullNewName.value);
}

function handleCancel() {
	emit('cancel');
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter' && isValid.value && hasChanges.value) {
		event.preventDefault();
		handleSubmit();
	}
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent size="sm" class="overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>{{ t('dialogs.renameDirItemDialog.renameItem') }}</DialogTitle>
      </DialogHeader>

      <div class="flex w-full min-w-0 flex-col gap-4">
        <FormGroup :label="t('dialogs.renameDirItemDialog.newName')" html-for="rename-input">
          <div class="flex w-full min-w-0 items-center gap-2">
            <TextInput id="rename-input" ref="field" v-model="newName" class="min-w-0 flex-1"
              :invalid="Boolean(newName) && !isValid" @keydown="handleKeydown" />
            <ActionButton :label="t('save')" :disabled="!isValid || !hasChanges" :loading="isSubmitting"
              @click="handleSubmit" />
          </div>
        </FormGroup>
      </div>

      <DialogFooter />
    </DialogContent>
  </Dialog>
</template>
