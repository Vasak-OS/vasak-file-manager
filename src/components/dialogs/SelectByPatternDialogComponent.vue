<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ref, watch } from 'vue';
import PromptDialogComponent from '@/components/dialogs/PromptDialogComponent.vue';

const emit = defineEmits<{
	confirm: [pattern: string];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });
const pattern = ref('*');

// Arranca en `*` y con el texto seleccionado, así escribir lo reemplaza.
watch(isOpen, (open) => {
	if (open) pattern.value = '*';
});
</script>

<template>
  <PromptDialogComponent v-model:open="isOpen" v-model:value="pattern"
    :title="t('dialogs.selectByPatternDialog.title')" :label="t('dialogs.selectByPatternDialog.label')"
    :confirm-label="t('dialogs.selectByPatternDialog.confirm')" select-on-open
    @confirm="emit('confirm', $event)" @cancel="emit('cancel')" />
</template>
