import { computed, type Ref } from 'vue';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import type { DirEntry } from '@/types/dir-entry';
import type { ListSortColumn, ListSortDirection } from '@/types/file-browser';
import { sortFileBrowserEntries } from '@/utils/file-browser-sort';

type DirectoryContents = {
	entries: DirEntry[];
};

export function useFileBrowserEntries(
	dirContents: Ref<DirectoryContents | null>,
	filterQuery: Ref<string>,
	showHiddenFiles: Ref<boolean>,
	sortColumn: Ref<ListSortColumn | null>,
	sortDirection: Ref<ListSortDirection>
) {
	const dirSizesStore = useDirSizesStore();

	function isHiddenFile(entry: DirEntry): boolean {
		return entry.is_hidden || entry.name.startsWith('.');
	}

	const entries = computed(() => {
		if (!dirContents.value) return [];
		let items = dirContents.value.entries;

		if (!showHiddenFiles.value) {
			items = items.filter((item) => !isHiddenFile(item));
		}

		if (filterQuery.value) {
			const query = filterQuery.value.trim().toLowerCase();

			if (query) {
				items = items.filter((item) => item.name.toLowerCase().includes(query));
			}
		}

		// El orden es uno solo, y es el de `sortFileBrowserEntries`: carpetas
		// primero y después el criterio de la columna. Lo leen la vista y el
		// teclado, así que no hay un orden dibujado y otro para las flechas.
		const column = sortColumn.value ?? 'name';
		items = sortFileBrowserEntries(items, column, sortDirection.value, dirSizesStore);

		return items;
	});

	const isDirectoryEmpty = computed(() => {
		if (!dirContents.value) return false;
		return dirContents.value.entries.length === 0;
	});

	return {
		entries,
		isDirectoryEmpty,
	};
}
