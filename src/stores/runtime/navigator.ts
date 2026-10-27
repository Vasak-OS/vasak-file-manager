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

	/**
	 * Pedidos de abrir el panel de información.
	 *
	 * Es un contador y no un booleano: abrir el panel depende del formato de la
	 * ventana (en una columna es cambiar de columna; en varias, un flag
	 * persistido), y esa lógica vive en `WindowAppLayout`. Acá sólo se avisa
	 * «abrilo», y el layout lo observa. Un contador permite pedirlo de nuevo
	 * aunque el valor anterior fuera el mismo.
	 */
	const infoPanelOpenRequests = ref(0);

	function requestOpenInfoPanel() {
		infoPanelOpenRequests.value++;
	}

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
		infoPanelOpenRequests,
		requestOpenInfoPanel,
	};
});
