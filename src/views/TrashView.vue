<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	EmptyState,
	ThemeIcon,
} from '@vasakgroup/vue-libvasak';
import { ref } from 'vue';
import { toast } from '@/components/ui/toast/toaster';
import { useTrashStore } from '@/stores/runtime/trash';
import type { TrashEntry } from '@/types/trash';

const emit = defineEmits<{ close: [] }>();

const { t, locale } = useI18n();
const trashStore = useTrashStore();

const confirmEmptyOpen = ref(false);
const isEmptying = ref(false);

function formatDeleted(seconds: number): string {
	if (seconds < 0) return '';
	return new Date(seconds * 1000).toLocaleString(locale.value);
}

async function restore(item: TrashEntry) {
	try {
		await trashStore.restore([item.original_path]);
		toast.success({ title: 'notifications.restored' });
	} catch {
		toast.error({ title: 'notifications.restoreFailed' });
	}
}

async function confirmEmpty() {
	isEmptying.value = true;
	try {
		await trashStore.empty();
		toast.success({ title: 'notifications.trashEmptied' });
		confirmEmptyOpen.value = false;
	} catch {
		toast.error({ title: 'notifications.emptyTrashFailed' });
	} finally {
		isEmptying.value = false;
	}
}
</script>

<template>
  <div class="flex h-full flex-col rounded-corner-l border border-ui-line">
    <div class="flex min-w-0 items-center gap-2 p-2">
      <ThemeIcon name="user-trash" type="symbol" :size="20" />
      <span class="min-w-0 flex-1 truncate text-body-m font-medium text-tx-main">
        {{ t('trash.title') }}
      </span>
      <ActionButton :label="t('trash.empty')" variant="ghost"
        :disabled="trashStore.items.length === 0" @click="confirmEmptyOpen = true" />
      <ActionButton :label="''" :icon-alt="t('trash.close')" :title="t('trash.close')"
        icon="window-close" variant="ghost" @click="emit('close')" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <EmptyState v-if="trashStore.items.length === 0" icon="user-trash" icon-type="symbol"
        :title="t('trash.emptyTitle')" :note="t('trash.emptyNote')" />
      <ul v-else class="flex flex-col gap-0.5">
        <li v-for="item in trashStore.items" :key="`${item.original_path}:${item.deleted_time}`"
          class="flex items-center gap-3 rounded-corner-s px-2 py-1.5 hover:bg-ui-surface/70">
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-body-s text-tx-main">{{ item.name }}</span>
            <span class="truncate text-body-xs text-tx-muted">{{ item.original_path }}</span>
          </span>
          <span v-if="item.deleted_time >= 0" class="shrink-0 text-body-xs text-tx-muted">
            {{ formatDeleted(item.deleted_time) }}
          </span>
          <ActionButton :label="t('trash.restore')" variant="ghost" @click="restore(item)" />
        </li>
      </ul>
    </div>

    <!-- Vaciar borra para siempre: va con confirmación aparte. Mandar a la
         papelera no la pide; borrar definitivamente, sí. -->
    <Dialog v-model:open="confirmEmptyOpen">
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{{ t('trash.emptyConfirmTitle') }}</DialogTitle>
        </DialogHeader>
        <p class="m-0 text-body-s text-tx-muted">{{ t('trash.emptyConfirmQuestion') }}</p>
        <DialogFooter>
          <ActionButton :label="t('trash.cancel')" variant="ghost" @click="confirmEmptyOpen = false" />
          <ActionButton :label="t('trash.empty')" :loading="isEmptying" @click="confirmEmpty" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
