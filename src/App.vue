<script setup lang="ts">
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useConfigStore } from '@vasakgroup/plugin-config-manager';
import type { Store } from 'pinia';
import { onErrorCaptured, onMounted, onUnmounted, type Ref, ref } from 'vue';
import ToastContainer from '@/components/ui/toast/ToastContainer.vue';
import WindowAppLayout from '@/layouts/WindowAppLayout.vue';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import { disableWebViewFeatures } from '@/utils/web-view-features';

let unListenConfig: Ref<UnlistenFn | null> = ref(null);

onErrorCaptured((err) => {
	// Handle nextSibling and emitsOptions errors gracefully
	if (err instanceof TypeError) {
		const message = String(err);
		if (message.includes('nextSibling') || message.includes('emitsOptions')) {
			console.warn('Recovered from DOM/component error:', message);
			return false; // Prevent error from propagating
		}
	}
	return true; // Let other errors propagate normally
});

onMounted(async () => {
	try {
		const userPathsStore = useUserPathsStore();
		const workspacesStore = useWorkspacesStore();
		const shortcutsStore = useShortcutsStore();

		await userPathsStore.init();
		await workspacesStore.init();

		const configStore = useConfigStore() as Store<
			'config',
			{ config: any; loadConfig: () => Promise<void> }
		>;
		await configStore.loadConfig();
		unListenConfig.value = await listen('config-changed', async () => {
			document.startViewTransition(() => {
				configStore.loadConfig();
			});
		});
		disableWebViewFeatures();
		shortcutsStore.init();
	} catch (error: any) {
		console.error('Error al cargar configuración en App.vue', error);
	}
});

onUnmounted(() => {
	if (unListenConfig.value !== null) {
		unListenConfig.value();
	}
});
</script>

<template>
  <WindowAppLayout />
  <ToastContainer />
</template>
