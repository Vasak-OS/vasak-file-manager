<script lang="ts" setup>
import { computed } from 'vue';
import ContentInformationHeadComponent from '@/components/content/ContentInformationHeadComponent.vue';
import ContentInformationPreviewComponent from '@/components/content/ContentInformationPreviewComponent.vue';
import { useNavigatorStore } from '@/stores/runtime/navigator';
import type { DirEntry } from '@/types/dir-entry';
import ContentInformationContentProperies from './ContentInformationContentProperies.vue';

interface Props {
	selectedEntries?: DirEntry[];
	currentDirEntry?: DirEntry | null;
	/**
	 * Que ocupe el ancho que le den en vez de sus 272 píxeles: en una columna
	 * por vez la información va en lugar de los archivos.
	 */
	fill?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	selectedEntries: () => [],
	currentDirEntry: null,
	fill: false,
});

const navigatorStore = useNavigatorStore();

const infoPanelEntry = computed(() => {
	if (props.selectedEntries && props.selectedEntries.length > 0) {
		navigatorStore.updateInfoPanel(props.selectedEntries[props.selectedEntries.length - 1]);
		return props.selectedEntries[props.selectedEntries.length - 1];
	}

	if (props.currentDirEntry) {
		navigatorStore.updateInfoPanel(props.currentDirEntry);
		return props.currentDirEntry;
	}

	return null;
});
</script>

<template>
	<div
		class="flex h-full min-h-0 flex-col overflow-hidden rounded-corner-l border border-ui-line bg-ui-surface/70 p-2"
		:class="props.fill ? 'w-full min-w-0' : 'w-68'">
		<ContentInformationPreviewComponent :selectedEntry="infoPanelEntry" />
		<ContentInformationHeadComponent :selectedEntry="infoPanelEntry" />
		<ContentInformationContentProperies :selectedEntry="infoPanelEntry" />
	</div>
</template>