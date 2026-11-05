import { invoke } from '@tauri-apps/api/core';
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';

interface DirItemCountResult {
	path: string;
	count: number | null;
}

/**
 * Conteos de hijos de carpeta, calculados de forma perezosa.
 *
 * Listar ya no cuenta los hijos de cada subcarpeta (era el costo dominante);
 * la ventana pide el conteo sólo para las entradas visibles, igual que los
 * tamaños (`dir-sizes`). El conteo se guarda por ruta: `null` significa que no
 * se cuenta (sistema de archivos de red o error), que se muestra como «—»;
 * ausente del mapa significa que todavía no se pidió.
 */
export const useDirItemCountsStore = defineStore('dir-item-counts', () => {
	const counts = reactive(new Map<string, number | null>());
	const pending = ref<Set<string>>(new Set());

	function getCount(path: string): number | null | undefined {
		return counts.has(path) ? counts.get(path) : undefined;
	}

	function isLoading(path: string): boolean {
		return pending.value.has(path);
	}

	async function requestCountsBatch(paths: string[]): Promise<void> {
		const toFetch = paths.filter((path) => !counts.has(path) && !pending.value.has(path));

		if (toFetch.length === 0) {
			return;
		}

		for (const path of toFetch) {
			pending.value.add(path);
		}

		try {
			const results = await invoke<DirItemCountResult[]>('count_dir_items', { paths: toFetch });

			for (const result of results) {
				counts.set(result.path, result.count);
			}
		} catch (error) {
			console.error('Failed to count directory items:', error);
		} finally {
			for (const path of toFetch) {
				pending.value.delete(path);
			}
		}
	}

	function clearLocalCache() {
		counts.clear();
		pending.value.clear();
	}

	return {
		counts,
		pending,
		getCount,
		isLoading,
		requestCountsBatch,
		clearLocalCache,
	};
});
