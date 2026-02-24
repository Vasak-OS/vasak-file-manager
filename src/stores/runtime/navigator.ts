import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DirEntry } from '@/types/dir-entry';
import type { Runtime } from '@/types/runtime';
import { formatDateReadable } from '@/utils/date-formatter';

export const useNavigatorStore = defineStore('navigator', () => {
	const { t } = useI18n();

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
				title: t('path'),
				value: dirEntry.path,
				tooltip: 'copyPathTooltip',
			},
			{
				propName: 'dateCreated',
				title: t('sorting.typeShortTitles.dateCreated'),
				value: formatDateReadable(dirEntry.created_time),
				tooltip: `${t('toCopy')}: ${'copyShortcut'}`,
			},
			{
				propName: 'dateModified',
				title: t('sorting.typeShortTitles.dateModified'),
				value: formatDateReadable(dirEntry.modified_time),
				tooltip: `${t('toCopy')}: ${'copyShortcut'}`,
			},
			{
				propName: 'dateAccessed',
				title: t('sorting.typeShortTitles.dateAccessed'),
				value: formatDateReadable(dirEntry.accessed_time),
				tooltip: `${t('toCopy')}: ${'copyShortcut'}`,
			},
		];
	}

	return {
		runtime,
		updateInfoPanel,
	};
});
