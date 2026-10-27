<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, ref, watch } from 'vue';
import PromptDialogComponent from '@/components/dialogs/PromptDialogComponent.vue';

const props = defineProps<{
	type: 'directory' | 'file';
}>();

const emit = defineEmits<{
	confirm: [name: string];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

const name = ref('');
const isSubmitting = ref(false);

const dialogTitle = computed(() =>
	t(
		props.type === 'directory'
			? 'dialogs.newItemDialog.newDirectory'
			: 'dialogs.newItemDialog.newFile'
	)
);

function isValidName(trimmedName: string): boolean {
	if (!trimmedName) return false;

	// biome-ignore lint/suspicious/noControlCharactersInRegex: we explicitly want to match null character and other control characters
	const invalidChars = /[<>:"/\\|?*\u0000-\u001F]/;

	if (invalidChars.test(trimmedName)) return false;
	if (trimmedName === '.' || trimmedName === '..') return false;

	return true;
}

// Si se vuelve a escribir tras un intento, se apaga el estado de envío.
watch(name, () => {
	if (isSubmitting.value) isSubmitting.value = false;
});

watch(isOpen, (open) => {
	if (open) {
		name.value = '';
		isSubmitting.value = false;
	}
});

function handleConfirm() {
	isSubmitting.value = true;
	emit('confirm', name.value.trim());
}
</script>

<template>
  <PromptDialogComponent v-model:open="isOpen" v-model:value="name" :title="dialogTitle"
    :label="t('name')" :confirm-label="t('create')" :loading="isSubmitting" :validate="isValidName"
    @confirm="handleConfirm" @cancel="emit('cancel')" />
</template>
