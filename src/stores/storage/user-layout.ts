import { LazyStore } from '@tauri-apps/plugin-store';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Layout } from '@/types/navigator';
import { useUserPathsStore } from './user-paths';

const DEFAULT_LAYOUT: Layout = 'grid';

interface UserLayoutState {
	layout: Layout;
}

export const useUserLayoutStore = defineStore('userLayout', () => {
	const userPathsStore = useUserPathsStore();
	const userLayoutStorage = ref<LazyStore | null>(null);
	const userLayout = ref<UserLayoutState>({
		layout: DEFAULT_LAYOUT,
	});

	const layout = computed(() => userLayout.value.layout);

	async function initStorage() {
		try {
			if (!userLayoutStorage.value) {
				userLayoutStorage.value = await new LazyStore(
					userPathsStore.customPaths.appUserDataLayoutPath
				);
				await userLayoutStorage.value.save();
			}
		} catch (error) {
			console.error('Failed to initialize user layout storage:', error);
		}
	}

	async function loadLayout() {
		try {
			const storedLayout = await userLayoutStorage.value?.get<Layout>('layout');

			if (storedLayout) {
				userLayout.value.layout = storedLayout;
			}
		} catch (error) {
			console.error('Failed to load user layout:', error);
		}
	}

	async function saveLayout() {
		try {
			if (userLayoutStorage.value) {
				await userLayoutStorage.value.set('layout', userLayout.value.layout);
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

	async function init() {
		await initStorage();
		await loadLayout();
	}

	return {
		userLayout,
		layout,
		init,
		setLayout,
	};
});
