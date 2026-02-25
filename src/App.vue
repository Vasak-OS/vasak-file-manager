<script setup lang="ts">
/** biome-ignore-all lint/correctness/noUnusedImports: <Use in template> */
/** biome-ignore-all lint/correctness/noUnusedVariables: <Use in template> */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useConfigStore } from '@vasakgroup/plugin-config-manager';
import I18n from '@vasakgroup/tauri-plugin-i18n';
import type { Store } from 'pinia';
import { onMounted, onUnmounted, type Ref, ref } from 'vue';
import ToastContainer from '@/components/ui/toast/ToastContainer.vue';
import WindowAppLayout from '@/layouts/WindowAppLayout.vue';

let unListenConfig: Ref<UnlistenFn | null> = ref(null);

onMounted(async () => {
	try {
		const configStore = useConfigStore() as Store<
			'config',
			{ config: any; loadConfig: () => Promise<void> }
		>;
		await configStore.loadConfig();
		await I18n.getInstance().load();
		unListenConfig.value = await listen('config-changed', async () => {
			document.startViewTransition(() => {
				configStore.loadConfig();
			});
		});
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
