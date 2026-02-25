import type { Ref } from 'vue';
import { onMounted, watch } from 'vue';
import type { Tab } from '@/types/workspaces';

export function useFileBrowserLifecycle(options: {
	tabRef: Ref<Tab | undefined>;
	readDir: (path: string, shouldRefresh: boolean) => Promise<void>;
	init: () => void;
}) {
	onMounted(() => {
		options.init();
	});

	watch(
		() => options.tabRef.value?.id,
		async (newTabId, oldTabId) => {
			if (newTabId && newTabId !== oldTabId && options.tabRef.value?.path) {
				await options.readDir(options.tabRef.value.path, false);
			}
		}
	);
}
