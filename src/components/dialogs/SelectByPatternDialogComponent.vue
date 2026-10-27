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

const emit = defineEmits<{
	confirm: [pattern: string];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

/**
 * El campo es el `TextInput` de la librería, cuya raíz es el `<input>`: se toma
 * de ahí para enfocarlo al abrir, que la librería no expone.
 */
const field = ref<InstanceType<typeof TextInput> | null>(null);
const inputRef = computed(() => (field.value?.$el as HTMLInputElement | undefined) ?? null);
const pattern = ref('');

const trimmedPattern = computed(() => pattern.value.trim());
const isValid = computed(() => trimmedPattern.value.length > 0);

watch(isOpen, (open) => {
	if (open) {
		pattern.value = '*';
		nextTick(() => {
			inputRef.value?.focus();
			inputRef.value?.select();
		});
	} else {
		emit('cancel');
	}
});

function handleSubmit() {
	if (!isValid.value) return;
	emit('confirm', trimmedPattern.value);
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
        <DialogTitle>{{ t('dialogs.selectByPatternDialog.title') }}</DialogTitle>
      </DialogHeader>

      <div class="flex w-full min-w-0 flex-col gap-4">
        <FormGroup :label="t('dialogs.selectByPatternDialog.label')" html-for="select-pattern-input">
          <div class="flex w-full min-w-0 items-center gap-2">
            <TextInput id="select-pattern-input" ref="field" v-model="pattern" class="min-w-0 flex-1"
              @keydown="handleKeydown" />
            <ActionButton :label="t('dialogs.selectByPatternDialog.confirm')" :disabled="!isValid"
              @click="handleSubmit" />
          </div>
        </FormGroup>
      </div>

      <DialogFooter />
    </DialogContent>
  </Dialog>
</template>
