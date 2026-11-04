import { invoke } from '@tauri-apps/api/core';
import { ref } from 'vue';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import type { DirContents } from '@/types/dir-entry';

export interface TemplateFile {
	name: string;
	path: string;
}

/**
 * Las plantillas de `~/Templates` (`XDG_TEMPLATES_DIR`) para el submenú «Nuevo
 * documento». La carpeta puede no estar configurada o no existir: en ese caso la
 * lista queda vacía y el submenú no se muestra.
 */
export function useTemplates() {
	const userPathsStore = useUserPathsStore();
	const templates = ref<TemplateFile[]>([]);

	async function loadTemplates() {
		const dir = userPathsStore.userPaths.templateDir;
		if (!dir) {
			templates.value = [];
			return;
		}

		try {
			const contents = await invoke<DirContents>('read_dir', { path: dir });
			templates.value = contents.entries
				.filter((entry) => entry.is_file && !entry.is_hidden)
				.map((entry) => ({ name: entry.name, path: entry.path }))
				.sort((a, b) => a.name.localeCompare(b.name));
		} catch (error) {
			console.error('No se pudieron leer las plantillas:', error);
			templates.value = [];
		}
	}

	return { templates, loadTemplates };
}
