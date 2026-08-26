<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useConfigStore } from '@vasakgroup/plugin-config-manager';
import type { Store } from 'pinia';
import { onErrorCaptured, onMounted, onUnmounted, type Ref, ref } from 'vue';
import TextContextMenu from '@/components/ui/TextContextMenu.vue';
import ToastContainer from '@/components/ui/toast/ToastContainer.vue';
import WindowAppLayout from '@/layouts/WindowAppLayout.vue';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useUserLayoutStore } from '@/stores/storage/user-layout';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useWorkspacesStore } from '@/stores/storage/workspaces';

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
		console.error(
			'[InvalidCharacterError captured]',
			{
				name: err.name,
				message: err.message,
				code: (err as any).code,
				stack: err.stack?.split('\n').slice(0, 5).join('\n'),
			},
			'info:',
			info,
			'component:',
			(instance as any)?.type?.__name || (instance as any)?.type?.name
		);
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

		// Si nos abrieron con una ruta —«abrir carpeta contenedora» de una
		// descarga, un directorio desde otra aplicación—, esa carpeta va en una
		// pestaña nueva y al frente. Va después de restaurar el espacio de
		// trabajo para no pisar las pestañas que ya tenías.
		const requestedPath = await invoke<string | null>('startup_path');

		if (requestedPath) {
			await workspacesStore.openNewTabGroup(requestedPath);
		}

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

		// La búsqueda global se inicializa acá y no en su propia vista: es lo que
		// engancha la señal de inactividad del compositor, y esa señal es la que
		// decide cuándo reindexar. Colgada de abrir el panel, quien no lo abría
		// nunca no reindexaba nunca —hasta ahora nadie llamaba a `initOnLaunch`,
		// así que no reindexaba nadie—.
		//
		// Sin `await` y con su propio catch: si el índice no se puede inicializar,
		// el gestor de archivos tiene que abrir igual. Lo demás de este bloque ya
		// terminó, así que no hay nada que se quede esperando.
		void useGlobalSearchStore()
			.initOnLaunch()
			.catch((error) => console.error('No se pudo inicializar la búsqueda global', error));
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
  <!-- Una sola vez: escucha en el documento, así los diálogos que aparecen y
       desaparecen no tienen que acordarse de nada. -->
  <TextContextMenu />
</template>
