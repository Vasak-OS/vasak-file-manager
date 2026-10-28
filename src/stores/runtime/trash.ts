import { invoke } from '@tauri-apps/api/core';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TrashEntry } from '@/types/trash';

/**
 * La papelera como vista overlay, igual que la búsqueda global: un `isOpen` que
 * `NavigatorBar` dibuja con `v-show`, y la lista que el backend arma sobre
 * `trash::os_limited`. No es una pestaña: lo que hay en la papelera no está en
 * su ruta original, así que no pasa por el navegador de carpetas.
 */
export const useTrashStore = defineStore('trash', () => {
	const isOpen = ref(false);
	const items = ref<TrashEntry[]>([]);
	const isLoading = ref(false);

	async function load() {
		isLoading.value = true;
		try {
			items.value = await invoke<TrashEntry[]>('list_trash');
		} catch (error) {
			console.error('No se pudo listar la papelera:', error);
			items.value = [];
		} finally {
			isLoading.value = false;
		}
	}

	async function open() {
		isOpen.value = true;
		await load();
	}

	function close() {
		isOpen.value = false;
	}

	/** Restaura las entradas por su ruta original; devuelve cuántas volvieron. */
	async function restore(paths: string[]): Promise<number> {
		const restored = await invoke<number>('restore_trash', { paths });
		await load();
		return restored;
	}

	/** Vacía la papelera; devuelve cuántos elementos se borraron. */
	async function empty(): Promise<number> {
		const emptied = await invoke<number>('empty_trash');
		await load();
		return emptied;
	}

	return { isOpen, items, isLoading, open, close, load, restore, empty };
});
