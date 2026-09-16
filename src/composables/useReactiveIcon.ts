import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { olvidarIconos } from '@/utils/images';

let unlisten: UnlistenFn | null = null;
let subscribers = 0;
const version = ref(0);

export function useReactiveIcon(fetcher: () => Promise<string>) {
	const source = ref('');

	watch(
		version,
		async () => {
			try {
				source.value = await fetcher();
			} catch {
				source.value = '';
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
