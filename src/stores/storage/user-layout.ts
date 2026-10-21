import { LazyStore } from '@tauri-apps/plugin-store';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Layout } from '@/types/navigator';
import { useUserPathsStore } from './user-paths';

const DEFAULT_LAYOUT: Layout = 'grid';

interface UserLayoutState {
	layout: Layout;
	infoPanelVisible: boolean;
}

export const useUserLayoutStore = defineStore('userLayout', () => {
	const userPathsStore = useUserPathsStore();
	const userLayoutStorage = ref<LazyStore | null>(null);
	const userLayout = ref<UserLayoutState>({
		layout: DEFAULT_LAYOUT,
		infoPanelVisible: true,
	});

	const layout = computed(() => userLayout.value.layout);
	const infoPanelVisible = computed(() => userLayout.value.infoPanelVisible);

	async function initStorage() {
		try {
			if (!userLayoutStorage.value) {
				userLayoutStorage.value = new LazyStore(userPathsStore.customPaths.appUserDataLayoutPath);
				await userLayoutStorage.value.save();
			}
		} catch (error) {
			console.error('Failed to initialize user layout storage:', error);
		}
	}

	async function loadLayout() {
		try {
			const storedLayout = await userLayoutStorage.value?.get<Layout>('layout');
			const storedInfoPanel = await userLayoutStorage.value?.get<boolean>('infoPanelVisible');

			if (storedLayout) {
				userLayout.value.layout = storedLayout;
			}

			if (typeof storedInfoPanel === 'boolean') {
				userLayout.value.infoPanelVisible = storedInfoPanel;
			}
		} catch (error) {
			console.error('Failed to load user layout:', error);
		}
	}

	async function saveLayout() {
		try {
			if (userLayoutStorage.value) {
				await userLayoutStorage.value.set('layout', userLayout.value.layout);
				await userLayoutStorage.value.set('infoPanelVisible', userLayout.value.infoPanelVisible);
				await userLayoutStorage.value.save();
			}
		} catch (error) {
			console.error('Failed to save user layout:', error);
		}
	}

	async function setLayout(newLayout: Layout) {
		if (userLayout.value.layout === newLayout) return;

		userLayout.value.layout = newLayout;
		await saveLayout();
	}

	async function setInfoPanelVisible(visible: boolean) {
		if (userLayout.value.infoPanelVisible === visible) return;

		userLayout.value.infoPanelVisible = visible;
		await saveLayout();
	}

	async function init() {
		await initStorage();
		await loadLayout();
	}

	return {
		userLayout,
		layout,
		infoPanelVisible,
		init,
		setLayout,
		setInfoPanelVisible,
	};
});
