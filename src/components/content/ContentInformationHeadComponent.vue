<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import type { DirEntry } from '@/types/dir-entry';

const props = defineProps<{
	selectedEntry: DirEntry | null;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="flex items-center gap-3 px-4 py-2 border-b border-ui-border mb-4">
    <EntryIconComponent v-if="selectedEntry" :entry="selectedEntry" class="shrink-0 h-6 w-6" />
    <span class="overflow-hidden text-ellipsis whitespace-nowrap font-medium text-sm" :title="selectedEntry?.name">
      {{ selectedEntry?.name || t('noData') }}
    </span>
  </div>
</template>
