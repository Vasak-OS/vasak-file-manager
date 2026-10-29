<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	EmptyState,
} from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
import { interpolar } from '@/tools/interpolar';

/** Tope de filas dibujadas: un archivo con decenas de miles de entradas no cuelga el diálogo. */
const MAX_ROWS = 500;

const props = defineProps<{
	archiveName: string;
	items: string[];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

const visibleItems = computed(() => props.items.slice(0, MAX_ROWS));
const remainingCount = computed(() => Math.max(0, props.items.length - MAX_ROWS));
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent size="md" class="overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle class="truncate">
          {{ interpolar(t('dialogs.archiveContentDialog.title'), archiveName) }}
        </DialogTitle>
        <DialogDescription>
          {{ interpolar(t('dialogs.archiveContentDialog.count'), items.length) }}
        </DialogDescription>
      </DialogHeader>

      <EmptyState v-if="items.length === 0" :title="t('dialogs.archiveContentDialog.empty')" />

      <!-- La barra de desplazamiento la pone `scrollbar.css`. -->
      <ul v-else class="m-0 flex max-h-72 list-none flex-col gap-0.5 overflow-y-auto p-0">
        <li v-for="(item, index) in visibleItems" :key="index" :title="item"
          class="truncate rounded-corner-s bg-ui-surface/40 px-3 py-1.5 text-body-s text-tx-main">
          {{ item }}
        </li>
        <li v-if="remainingCount > 0" class="px-3 py-1.5 text-body-s italic text-tx-muted">
          {{ interpolar(t('dialogs.archiveContentDialog.andMore'), remainingCount) }}
        </li>
      </ul>
    </DialogContent>
  </Dialog>
</template>
