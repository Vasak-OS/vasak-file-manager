<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useConfigStore } from '@vasakgroup/plugin-config-manager';
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

// El estado de la primera lectura de la configuración. Va en su propio bloque
// dentro de `onMounted`: antes estaba en el mismo `try` que `shortcutsStore.init()`,
// así que una config ilegible saltaba al `catch` y los atajos de teclado nunca
// se inicializaban — un fallo de tema no puede apagar los atajos.
const configLoading = ref(true);
const configError = ref(false);

// Cuánto se espera a la configuración antes de seguir sin ella. Dos lecturas
// al proceso de Rust tardan milisegundos; el tope es para que un backend
// colgado no deje los atajos y la búsqueda global sin inicializar.
const PLAZO_CONFIG_MS = 3000;

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
	// Los stores de rutas, layout y espacios de trabajo primero: sin ellos el
	// gestor no puede trabajar. Van en su propio `try` para que un fallo acá
	// no salte al final y deje el banner de configuración clavado en
	// «Cargando…» para siempre, que es lo que pasaba con el `try` único.
	try {
		const userPathsStore = useUserPathsStore();
		const userLayoutStore = useUserLayoutStore();
		const workspacesStore = useWorkspacesStore();

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
	} catch (error: any) {
		console.error('Error al restaurar el espacio de trabajo', error);
	}

	// La configuración en su propio bloque —y con plazo—: ni un error ni un
	// backend colgado pueden impedir que más abajo se registren los atajos y
	// la búsqueda global. Si el plazo se vence, se sigue con los colores por
	// omisión; si la lectura termina después, el tema se aplica igual.
	const configStore = useConfigStore();
	try {
		const lectura = configStore.loadConfig();
		// Si vence el plazo y después la lectura falla, ese rechazo no puede
		// quedar sin atender.
		lectura.catch(() => {});
		await Promise.race([lectura, new Promise((resolve) => setTimeout(resolve, PLAZO_CONFIG_MS))]);
		configLoading.value = false;
	} catch (configError_: any) {
		configLoading.value = false;
		configError.value = true;
		console.error('Error al cargar la configuración', configError_);
	}

	// Fuera del `try` de la lectura: aunque esa falle o venza el plazo, los
	// cambios de configuración de después tienen que poder aplicarse.
	try {
		unListenConfig.value = await listen('config-changed', async () => {
			document.startViewTransition(() => {
				configStore.loadConfig();
			});
		});
	} catch (listenError: any) {
		console.error('No se pudo escuchar los cambios de configuración', listenError);
	}

	try {
		//disableWebViewFeatures();
		useShortcutsStore().init();
	} catch (error: any) {
		console.error('No se pudieron registrar los atajos de teclado', error);
	}

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
});

onUnmounted(() => {
	if (unListenConfig.value !== null) {
		unListenConfig.value();
	}
});
</script>

<template>
  <div v-if="configLoading" class="config-status">
    Cargando configuración…
  </div>
  <div v-else-if="configError" class="error-banner">
    Error al cargar configuración. Usando valores por defecto.
  </div>
  <WindowAppLayout />
  <ToastContainer />
  <!-- Una sola vez: escucha en el documento, así los diálogos que aparecen y
       desaparecen no tienen que acordarse de nada. -->
  <TextContextMenu />
</template>
