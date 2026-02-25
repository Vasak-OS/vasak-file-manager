import { type ComputedRef, computed, type Ref } from 'vue';
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
	sortDirection: Ref<ListSortDirection>,
	applySort: ComputedRef<boolean>
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

		if (applySort.value) {
			const column = sortColumn.value ?? 'name';
			items = sortFileBrowserEntries(items, column, sortDirection.value, dirSizesStore);
		}

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
