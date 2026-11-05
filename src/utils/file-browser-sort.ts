import type { useDirItemCountsStore } from '@/stores/runtime/dir-item-counts';
import type { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import type { DirEntry } from '@/types/dir-entry';
import type { ListSortColumn, ListSortDirection } from '@/types/file-browser';

type DirSizesStore = ReturnType<typeof useDirSizesStore>;
type DirItemCountsStore = ReturnType<typeof useDirItemCountsStore>;

export function sortFileBrowserEntries(
	items: DirEntry[],
	column: ListSortColumn,
	direction: ListSortDirection,
	dirSizesStore: DirSizesStore,
	dirItemCountsStore: DirItemCountsStore
): DirEntry[] {
	const multiplier = direction === 'asc' ? 1 : -1;

	function getSortSize(entry: DirEntry): number {
		if (entry.is_file) {
			return Number(entry.size) || 0;
		}

		const sizeInfo = dirSizesStore.getSize(entry.path);

		if (
			sizeInfo &&
			(sizeInfo.status === 'Complete' || (sizeInfo.status === 'Loading' && sizeInfo.size > 0))
		) {
			return sizeInfo.size;
		}

		return 0;
	}

	// El conteo ya no viene en la entrada: lo trae el store de forma perezosa.
	// Una carpeta cuyo conteo todavía no llegó se ordena como -1, igual que
	// antes ordenaba un `item_count` nulo. Al llegar los conteos, este cálculo
	// se recomputa y la lista se reacomoda en caliente.
	function getSortItems(entry: DirEntry): number {
		if (entry.is_file) {
			return -1;
		}

		const count = dirItemCountsStore.getCount(entry.path);
		return typeof count === 'number' ? count : -1;
	}

	return [...items].sort((entryA, entryB) => {
		const dirsFirst = entryA.is_dir === entryB.is_dir ? 0 : entryA.is_dir ? -1 : 1;

		if (dirsFirst !== 0) {
			return dirsFirst;
		}

		let comparison: number;

		if (column === 'name') {
			comparison = entryA.name.localeCompare(entryB.name, undefined, { numeric: true });
		} else if (column === 'items') {
			comparison = getSortItems(entryA) - getSortItems(entryB);
		} else if (column === 'size') {
			const sizeA = getSortSize(entryA);
			const sizeB = getSortSize(entryB);
			comparison = sizeA - sizeB;
		} else if (column === 'modified') {
			comparison = Number(entryA.modified_time) - Number(entryB.modified_time);
		} else {
			return 0;
		}

		return comparison * multiplier;
	});
}
