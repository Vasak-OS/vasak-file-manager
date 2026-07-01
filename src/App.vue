<script setup lang="ts">
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useConfigStore } from '@vasakgroup/plugin-config-manager';
import type { Store } from 'pinia';
import { onErrorCaptured, onMounted, onUnmounted, type Ref, ref } from 'vue';
import ToastContainer from '@/components/ui/toast/ToastContainer.vue';
import WindowAppLayout from '@/layouts/WindowAppLayout.vue';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useUserLayoutStore } from '@/stores/storage/user-layout';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import { disableWebViewFeatures } from '@/utils/web-view-features';

let unListenConfig: Ref<UnlistenFn | null> = ref(null);

onErrorCaptured((err, instance, info) => {
	// Handle nextSibling and emitsOptions errors gracefully
	if (err instanceof TypeError) {
		const message = String(err);
		if (message.includes('nextSibling') || message.includes('emitsOptions')) {
			console.warn('Recovered from DOM/component error:', message);
			return false;
		}
	}
	if (err instanceof DOMException || String(err).includes('InvalidCharacterError')) {
		console.error('[InvalidCharacterError captured]', {
			name: err.name,
			message: err.message,
			code: (err as any).code,
			stack: err.stack?.split('\n').slice(0, 5).join('\n'),
		}, 'info:', info, 'component:', (instance as any)?.type?.__name || (instance as any)?.type?.name);
		return false;
	}
	return true;
});

window.addEventListener('unhandledrejection', (event) => {
	console.error('[Unhandled Rejection]', event.reason, 'stack:', event.reason?.stack);
});

onMounted(async () => {
	try {
		const userPathsStore = useUserPathsStore();
		const userLayoutStore = useUserLayoutStore();
		const workspacesStore = useWorkspacesStore();
		const shortcutsStore = useShortcutsStore();

		await userPathsStore.init();
		await userLayoutStore.init();
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
		//disableWebViewFeatures();
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
