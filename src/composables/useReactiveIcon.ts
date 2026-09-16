import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { olvidarIconos } from '@/utils/images';

let unlisten: UnlistenFn | null = null;
let subscribers = 0;
const version = ref(0);

export function useReactiveIcon(fetcher: () => Promise<string>) {
	const source = ref('');

	/**
	 * Cuál es el pedido que vale.
	 *
	 * Al cambiar el tema se dispara uno nuevo sin cancelar el anterior, y el
	 * anterior puede contestar último: sin esta comparación escribiría el icono
	 * del tema viejo encima del nuevo, y ahí se queda hasta el siguiente
	 * cambio. Vale para los tres caminos —`getFileIcon`, `getIconSource` y
	 * `getSymbolSource`—, porque el que llega tarde es el mismo problema en los
	 * tres.
	 */
	let ultimoPedido = 0;

	watch(
		version,
		async () => {
			const mio = ++ultimoPedido;
			try {
				const nuevo = await fetcher();
				if (mio === ultimoPedido) source.value = nuevo;
			} catch {
				if (mio === ultimoPedido) source.value = '';
			}
		},
		{ immediate: true }
	);

	onMounted(async () => {
		subscribers++;
		if (subscribers === 1) {
			unlisten = await listen('vicons:theme-changed', () => {
				// Vaciar **antes** de disparar el redibujado, y en el mismo lugar
				// que lo dispara: si se vaciara en otro oyente, el orden entre los
				// dos no está garantizado y los observadores podrían tomar de la
				// caché los iconos del tema viejo.
				olvidarIconos();
				version.value++;
			});
		}
	});

	onUnmounted(() => {
		subscribers--;
		if (subscribers <= 0 && unlisten) {
			unlisten();
			unlisten = null;
		}
	});

	return source;
}
