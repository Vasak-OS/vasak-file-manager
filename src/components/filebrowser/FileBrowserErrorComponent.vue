<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ActionButton, ThemeIcon } from '@vasakgroup/vue-libvasak';

const { t } = useI18n();

/**
 * El icono del error.
 *
 * La plantilla escribía `<AlertCircleIcon />`, un componente que no se importa
 * en ningún lado: Vue no lo resolvía y la pantalla de error salía sin icono,
 * con un aviso en la consola que nadie mira. Es de cuando el proyecto usaba
 * lucide; el resto del repo ya pide los iconos al tema. Lo destapó
 * `strictTemplates`.
 */

defineProps<{
	error: string;
}>();

defineEmits<{
	goHome: [];
}>();
</script>

<template>
  <div class="flex h-full min-w-0 flex-col items-center justify-center gap-4 p-4 text-center">
    <ThemeIcon name="dialog-error" type="symbol" :size="32" class="text-status-error" />
    <span class="break-words text-body-s text-status-error">{{ error }}</span>
    <ActionButton :label="t('fileBrowser.goHome')" icon="go-home" variant="secondary" @click="$emit('goHome')" />
  </div>
</template>
