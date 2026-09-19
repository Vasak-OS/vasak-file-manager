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
}

const props = withDefaults(defineProps<Props>(), {
	selectedEntries: () => [],
	currentDirEntry: null,
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
	<div class="bg-ui-surface/70 rounded-corner h-full min-h-0 w-68 overflow-hidden p-2 border border-ui-border">
		<ContentInformationPreviewComponent :selectedEntry="infoPanelEntry" />
		<ContentInformationHeadComponent :selectedEntry="infoPanelEntry" />
		<ContentInformationContentProperies :selectedEntry="infoPanelEntry" />
	</div>
</template>