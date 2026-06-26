import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { onMounted, onUnmounted, ref, watch } from 'vue';

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
