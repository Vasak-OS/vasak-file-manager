<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	type PropertyItem as ListedProperty,
	PropertyList,
	ThemeIcon,
} from '@vasakgroup/vue-libvasak';
import { computed, watch } from 'vue';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';
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
			value: interpolar(
				t(claveSegunCantidad('fileBrowser.itemCount', entry.item_count)),
				entry.item_count
			),
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

/** Las propiedades, como las pide `PropertyList`. */
const propertyItems = computed<ListedProperty[]>(() =>
	properties.value.map((item) => ({ label: item.title, value: item.value }))
);
</script>

<template>
  <!-- Desplaza el espacio que le deja el panel (es la última pieza de una
       columna), en vez de calcularlo contra el alto de la pantalla. -->
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div v-if="!selectedEntry" class="flex h-full items-center justify-center text-body-s text-tx-muted">
      {{ t('noData') }}
    </div>
    <div v-else class="flex flex-col gap-3 px-2">
      <div v-if="selectedEntry?.is_dir" class="flex flex-col gap-1">
        <div class="text-label-s text-tx-muted">
          {{ t('size') }}
        </div>
        <div class="flex h-10 min-w-0 items-center gap-2 break-all">
          <template v-if="isDirSizeLoading">
            <ThemeIcon name="process-working" type="symbol" :size="14" class="animate-spin text-tx-muted" />
            <div class="flex min-w-0 flex-col gap-0.5 text-label-m">
              <span v-if="dirSizeDisplay">{{ dirSizeDisplay }}</span>
              <span v-else>{{ t('calculating') }}...</span>
            </div>
            <ActionButton label="" :icon-alt="t('cancel')" :title="t('cancel')" icon="window-close" variant="ghost"
              size="sm" class="ml-auto" @click="handleCancelSize" />
          </template>
          <template v-else-if="dirSizeDisplay && !showGetSizeButton">
            <div class="flex min-w-0 flex-col gap-0.5 text-label-m">
              <span>{{ dirSizeDisplay }}</span>
              <span v-if="calculatedAgo" class="text-label-xs text-tx-muted">{{ t('calculatedAgo').replace('{0}',
                calculatedAgo) }}</span>
            </div>
            <ActionButton v-if="showRecalculateButton" label="" :icon-alt="t('recalculate')" :title="t('recalculate')"
              icon="view-refresh" variant="ghost" size="sm" class="ml-auto" @click="handleGetSize" />
          </template>
          <ActionButton v-else-if="showGetSizeButton" :label="t('getSize')" variant="secondary" size="sm"
            @click="handleGetSize" />
        </div>
      </div>

      <PropertyList :items="propertyItems" layout="grid" class="[&_dd]:break-all" />
    </div>
  </div>
</template>
