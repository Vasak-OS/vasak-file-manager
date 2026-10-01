<script lang="ts" setup>
/**
 * Los avisos de la cola (`toaster.ts`), dibujados con `ToastArea`. Cómo se arma
 * cada uno está en `toast-notice.ts`.
 */
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ToastArea, type ToastNotice } from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
import { toNotice } from './toast-notice';
import { useToast } from './toaster';

const { t } = useI18n();
const { toasts } = useToast();

const notices = computed(() => [...toasts.value.values()].map((queued) => toNotice(queued, t)));

function handleAction(notice: ToastNotice) {
	toasts.value.get(notice.id)?.onAction?.();
}
</script>

<template>
  <ToastArea :toasts="notices" @action="handleAction" />
</template>
