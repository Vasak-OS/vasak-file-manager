import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DirEntry } from '@/types/dir-entry';
import type { Runtime } from '@/types/runtime';
import { formatDateReadable } from '@/utils/date-formatter';

export const useNavigatorStore = defineStore('navigator', () => {
	const runtime = ref<Runtime>({
		navigator: {
			infoPanel: {
				properties: [],
			},
		},
	});

	async function updateInfoPanel(dirEntry: DirEntry | null | undefined) {
		if (!dirEntry) {
			return;
		}

		setInfoPanelData(dirEntry);
	}

	async function setInfoPanelData(dirEntry: DirEntry) {
		runtime.value.navigator.infoPanel.properties = [
			{
				propName: 'path',
				title: 'path',
				value: dirEntry.path,
				tooltip: 'copyPathTooltip',
			},
			{
				propName: 'dateCreated',
				title: 'dateCreated',
				value: formatDateReadable(dirEntry.created_time),
				tooltip: `${'toCopy'}: ${'copyShortcut'}`,
			},
			{
				propName: 'dateModified',
				title: 'dateModified',
				value: formatDateReadable(dirEntry.modified_time),
				tooltip: `${'toCopy'}: ${'copyShortcut'}`,
			},
			{
				propName: 'dateAccessed',
				title: 'dateAccessed',
				value: formatDateReadable(dirEntry.accessed_time),
				tooltip: `${'toCopy'}: ${'copyShortcut'}`,
			},
		];
	}

	return {
		runtime,
		updateInfoPanel,
	};
});
