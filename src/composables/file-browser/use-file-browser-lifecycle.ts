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
				// Requirement 5.2: readDir will check the directory cache first.
				// If the tab was previously visited the cache hit restores content
				// without a filesystem call or loading state.
				await options.readDir(options.tabRef.value.path, false);
			}
		}
	);
}
