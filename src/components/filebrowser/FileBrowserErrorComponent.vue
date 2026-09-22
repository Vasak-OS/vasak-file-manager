<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ThemeIcon } from '@vasakgroup/vue-libvasak';

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
  <div class="flex h-full flex-col items-center justify-center text-status-error gap-4">
    <ThemeIcon name="dialog-error" type="symbol" :size="32" />
    <span>{{ error }}</span>
    <button type="button" class="rounded border border-ui-border bg-secondary text-tx-on-secondary px-3 py-1.5 text-xs leading-[1.2] cursor-pointer hover:bg-secondary/90" @click="$emit('goHome')">
      {{ t('fileBrowser.goHome') }}
    </button>
  </div>
</template>
