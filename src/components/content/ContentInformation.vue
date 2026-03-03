<script lang="ts" setup>
import { computed } from 'vue';
import { useNavigatorStore } from '@/stores/runtime/navigator';
import type { DirEntry } from '@/types/dir-entry';

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
	<div class="bg-ui-bg/80 rounded-corner h-full w-60 overflow-y-auto p-4">
		<div v-if="infoPanelEntry" class="space-y-4">
			<div>
				<h3 class="font-semibold text-sm mb-2">{{ infoPanelEntry.name }}</h3>
				<p class="text-xs opacity-70">{{ infoPanelEntry.path }}</p>
			</div>

			<div v-if="navigatorStore.runtime.navigator.infoPanel.properties.length > 0">
				<div v-for="prop in navigatorStore.runtime.navigator.infoPanel.properties" :key="prop.propName"
					class="border-t border-opacity-10 pt-2 mt-2">
					<p class="text-xs opacity-60">{{ prop.title }}</p>
					<p class="text-sm font-medium">{{ prop.value }}</p>
				</div>
			</div>
		</div>
		<div v-else class="flex items-center justify-center h-full opacity-40">
			<p class="text-sm">noSelection</p>
		</div>
	</div>
</template>