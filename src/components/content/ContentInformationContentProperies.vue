<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, watch } from 'vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import type { DirEntry } from '@/types/dir-entry';
import { formatBytes } from '@/utils/byte-parser';
import { formatDate, formatRelativeTime } from '@/utils/date-formatter';

const props = defineProps<{
	selectedEntry: DirEntry | null;
	orientation?: 'vertical' | 'compact';
}>();

const { t } = useI18n();
const dirSizesStore = useDirSizesStore();

const dirSizeInfo = computed(() => {
	if (!props.selectedEntry?.is_dir) return null;
	return dirSizesStore.getSize(props.selectedEntry.path);
});

const isDirSizeLoading = computed(() => {
	if (!props.selectedEntry?.is_dir) return false;
	return dirSizesStore.isLoading(props.selectedEntry.path);
});

const showGetSizeButton = computed(() => {
	if (!props.selectedEntry?.is_dir) return false;
	const info = dirSizeInfo.value;
	return !info;
});

const showRecalculateButton = computed(() => {
	if (!props.selectedEntry?.is_dir) return false;
	const info = dirSizeInfo.value;
	if (!info) return false;

	return info.status === 'Complete';
});

const dirSizeDisplay = computed(() => {
	const info = dirSizeInfo.value;
	if (!info) return null;
	if (info.status === 'Loading' && info.size > 0) return formatBytes(info.size);
	if (info.status === 'Loading') return null;
	if (info.status === 'Complete') return formatBytes(info.size);
	return null;
});

const relativeTimeTranslations = computed(() => ({
	justNow: t('relativeTime.justNow'),
	minutesAgo: (count: number) => t('relativeTime.minutesAgo').replace('{0}', String(count)),
	hoursAgo: (count: number) => t('relativeTime.hoursAgo').replace('{0}', String(count)),
	daysAgo: (count: number) => t('relativeTime.daysAgo').replace('{0}', String(count)),
}));

const calculatedAgo = computed(() => {
	const info = dirSizeInfo.value;
	if (!info) return null;
	if (info.status === 'Loading') return null;
	if (!info.calculatedAt) return null;

	return formatRelativeTime(info.calculatedAt, relativeTimeTranslations.value);
});

async function handleGetSize() {
	if (!props.selectedEntry?.is_dir) return;
	await dirSizesStore.requestSizeForce(props.selectedEntry.path);
}

async function handleCancelSize() {
	if (!props.selectedEntry?.is_dir) return;
	await dirSizesStore.cancelSize(props.selectedEntry.path);
}

watch(
	() => props.selectedEntry?.path,
	() => {
		// Reset state when entry changes
	},
	{ immediate: true }
);

interface PropertyItem {
	title: string;
	value: string;
}

const properties = computed<PropertyItem[]>(() => {
	if (!props.selectedEntry) return [];

	const entry = props.selectedEntry;
	const items: PropertyItem[] = [];

	items.push({
		title: t('type'),
		value: entry.is_dir ? t('directory') : entry.mime || t('file'),
	});
	items.push({
		title: t('path'),
		value: entry.path,
	});

	if (entry.is_file) {
		items.push({
			title: t('size'),
			value: formatBytes(entry.size),
		});
	}

	if (entry.is_dir && entry.item_count !== null) {
		items.push({
			title: t('items'),
			value: t('fileBrowser.itemCount').replace('{0}', String(entry.item_count)),
		});
	}

	if (entry.ext) {
		items.push({
			title: t('extension'),
			value: `.${entry.ext}`,
		});
	}

	if (entry.modified_time) {
		items.push({
			title: t('modified'),
			value: formatDate(entry.modified_time, true),
		});
	}

	if (entry.created_time) {
		items.push({
			title: t('created'),
			value: formatDate(entry.created_time, true),
		});
	}

	if (entry.accessed_time) {
		items.push({
			title: t('accessed'),
			value: formatDate(entry.accessed_time, true),
		});
	}

	if (entry.is_symlink) {
		items.push({
			title: t('symlink'),
			value: t('yes'),
		});
	}

	if (entry.is_hidden) {
		items.push({
			title: t('hidden'),
			value: t('yes'),
		});
	}

	return items;
});

const compactItems = computed<string[]>(() => {
	if (!props.selectedEntry) return [];

	const entry = props.selectedEntry;
	const items: string[] = [];

	items.push(entry.is_dir ? t('directory') : entry.ext ? `.${entry.ext}` : t('file'));

	if (entry.is_file) {
		items.push(formatBytes(entry.size));
	} else if (entry.is_dir) {
		if (dirSizeDisplay.value) {
			items.push(dirSizeDisplay.value);
		}

		if (entry.item_count !== null) {
			items.push(t('fileBrowser.itemCount').replace('{0}', String(entry.item_count)));
		}
	}

	if (entry.modified_time) {
		items.push(formatDate(entry.modified_time, false));
	}

	return items;
});
</script>

<template>
  <ScrollArea>
    <div v-if="!selectedEntry" class="flex h-full items-center justify-center text-sm text-tx-muted">
      {{ t('noData') }}
    </div>
    <div v-else class="flex flex-col gap-3 max-h-[calc(100vh-300px)] overflow-auto">
      <div v-if="selectedEntry?.is_dir" class="flex flex-col gap-1">
        <div class="text-sm uppercase text-tx-muted">
          {{ t('size') }}
        </div>
        <div class="break-all flex items-center gap-2 h-10">
          <template v-if="isDirSizeLoading">
            <LoaderCircleIcon :size="14" class="info-panel-properties__spinner" />
            <div class="info-panel-properties__size-content">
              <span v-if="dirSizeDisplay">{{ dirSizeDisplay }}</span>
              <span v-else>{{ t('calculating') }}...</span>
            </div>
            <button size="xs" variant="ghost" class="info-panel-properties__cancel-btn" @click="handleCancelSize">
              <XIcon :size="14" />
            </button>
          </template>
          <template v-else-if="dirSizeDisplay && !showGetSizeButton">
            <div class="info-panel-properties__size-content">
              <span>{{ dirSizeDisplay }}</span>
              <span v-if="calculatedAgo" class="info-panel-properties__calculated-ago">{{ t('calculatedAgo').replace('{0}',
                calculatedAgo) }}</span>
            </div>
            <Button v-if="showRecalculateButton" size="xs" variant="ghost"
              class="info-panel-properties__recalculate-btn" :title="t('recalculate')" @click="handleGetSize">
              <RefreshCwIcon :size="12" />
            </Button>
          </template>
          <Button v-else-if="showGetSizeButton" size="xs" variant="secondary" @click="handleGetSize">
            {{ t('getSize') }}
          </Button>
        </div>
      </div>

      <div v-for="(item, index) in properties" :key="index" class="flex flex-col gap-1">
        <div class="text-sm uppercase text-tx-muted">
          {{ item.title }}
        </div>
        <div class="break-all">
          {{ item.value }}
        </div>
      </div>
    </div>
  </ScrollArea>
</template>

<style scoped>
.info-panel-properties--compact {
  overflow: hidden;
  min-width: 0;
  padding: 0;
}

.info-panel-properties__compact-text {
  overflow: hidden;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-panel-properties__size-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-panel-properties__calculated-ago {
  color: hsl(var(--muted-foreground) / 70%);
  font-size: 11px;
}

.info-panel-properties__spinner {
  animation: spin 1s linear infinite;
  color: hsl(var(--muted-foreground));
}

.info-panel-properties__cancel-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  margin-left: auto;
  color: hsl(var(--muted-foreground));
}

.info-panel-properties__cancel-btn:hover {
  color: hsl(var(--destructive));
}

.info-panel-properties__recalculate-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  margin-left: auto;
  color: hsl(var(--muted-foreground));
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

.info-panel-properties__recalculate-btn:hover {
  color: hsl(var(--primary));
  opacity: 1;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>