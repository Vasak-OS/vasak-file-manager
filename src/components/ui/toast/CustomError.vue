<script lang="ts" setup>
/**
 * El aviso de que algo no se pudo hacer.
 *
 * Igual que `CustomSimple` pero con el ícono y el color de error: un fallo con
 * el tilde verde del aviso de éxito se lee como lo contrario de lo que dice.
 *
 * El texto llega **ya traducido**: quien lo muestra tiene el `useI18n` a mano y
 * así este componente no necesita saber de catálogos.
 */
interface Props {
	title: string;
	description?: string;
}

defineProps<Props>();
</script>

<template>
  <div class="flex items-start gap-3 w-full max-w-md p-4 rounded-corner bg-ui-bg/80 border border-ui-border">
    <div class="flex-shrink-0 w-5 h-5 rounded-full bg-status-error/20 flex items-center justify-center mt-0.5">
      <svg class="w-3 h-3 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>

    <div class="flex-1 min-w-0">
      <h3 class="font-semibold text-sm text-tx-main">{{ title }}</h3>
      <p v-if="description" class="text-xs text-tx-muted mt-1 break-words">{{ description }}</p>
    </div>
  </div>
</template>
