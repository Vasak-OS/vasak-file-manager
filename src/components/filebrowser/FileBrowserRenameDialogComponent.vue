<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import Dialog from '@/components/ui/dialog/Dialog.vue';
import DialogContent from '@/components/ui/dialog/DialogContent.vue';
import DialogFooter from '@/components/ui/dialog/DialogFooter.vue';
import DialogHeader from '@/components/ui/dialog/DialogHeader.vue';
import DialogTitle from '@/components/ui/dialog/DialogTitle.vue';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
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

const inputRef = ref<HTMLInputElement | null>(null);
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

	const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;

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
    <DialogContent class="file-browser-rename-dialog">
      <DialogHeader>
        <DialogTitle>{{ t('dialogs.renameDirItemDialog.renameItem') }}</DialogTitle>
      </DialogHeader>

      <div class="file-browser-rename-dialog__form">
        <div class="file-browser-rename-dialog__field-wrapper">
          <label for="rename-input" class="file-browser-rename-dialog__label">
            {{ t('dialogs.renameDirItemDialog.newName') }}
          </label>
          <div class="file-browser-rename-dialog__field">
            <input id="rename-input" ref="inputRef" v-model="newName" type="text"
              :class="{ 'file-browser-rename-dialog__input--error': newName && !isValid }" @keydown="handleKeydown" />
            <button type="button" :disabled="!isValid || !hasChanges || isSubmitting" @click="handleSubmit">
              {{ t('save') }}
            </button>
          </div>
        </div>
      </div>

      <DialogFooter />
    </DialogContent>
  </Dialog>
</template>

<style>
.file-browser-rename-dialog {
  width: 420px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  overflow-x: hidden;
}

.file-browser-rename-dialog>* {
  min-width: 0;
}

.file-browser-rename-dialog__form {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
}

.file-browser-rename-dialog__field-wrapper {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.file-browser-rename-dialog__field {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.file-browser-rename-dialog__label {
  color: hsl(var(--foreground));
  font-size: 14px;
  font-weight: 500;
}

.file-browser-rename-dialog__field .sigma-ui-input {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

.file-browser-rename-dialog__input--error {
  border-color: hsl(var(--destructive));
}

.file-browser-rename-dialog__current-name {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  padding: 8px 12px;
  border-radius: var(--radius);
  background-color: hsl(var(--muted) / 50%);
  font-size: 13px;
  gap: 4px;
}

.file-browser-rename-dialog__current-label {
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
}

.file-browser-rename-dialog__current-value {
  min-width: 0;
  color: hsl(var(--foreground));
  font-family: monospace;
  overflow-wrap: break-word;
}
</style>