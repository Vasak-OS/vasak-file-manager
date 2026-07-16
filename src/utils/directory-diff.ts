import type { DirEntry } from '@/types/dir-entry';

export interface DirectoryDiff {
	/** Entries present in newEntries but not in oldEntries */
	added: DirEntry[];
	/** Paths of entries present in oldEntries but not in newEntries */
	removed: string[];
	/** Entries whose path exists in both but whose metadata changed (size, modified_time, or name) */
	updated: DirEntry[];
}

/**
 * Computes the minimal diff between an old and new directory listing.
 *
 * - `added`: entries in newEntries whose path doesn't exist in oldEntries
 * - `removed`: paths of entries in oldEntries that don't exist in newEntries
 * - `updated`: entries in newEntries whose path exists in oldEntries but whose
 *   metadata changed (size, modified_time, or name)
 *
 * Requirement 3.6: diff mínimo que solo agregue, elimine o actualice entradas que cambiaron.
 * Requirement 5.4: aplicar diff sin reemplazar lista completa.
 */
export function computeDiff(oldEntries: DirEntry[], newEntries: DirEntry[]): DirectoryDiff {
	const oldMap = new Map<string, DirEntry>();
	for (const entry of oldEntries) {
		oldMap.set(entry.path, entry);
	}

	const added: DirEntry[] = [];
	const updated: DirEntry[] = [];
	const newPaths = new Set<string>();

	for (const entry of newEntries) {
		newPaths.add(entry.path);
		const oldEntry = oldMap.get(entry.path);

		if (!oldEntry) {
			added.push(entry);
		} else if (hasMetadataChanged(oldEntry, entry)) {
			updated.push(entry);
		}
	}

	const removed: string[] = [];
	for (const entry of oldEntries) {
		if (!newPaths.has(entry.path)) {
			removed.push(entry.path);
		}
	}

	return { added, removed, updated };
}

/**
 * Applies a diff to an entry array and returns the new array.
 *
 * Steps:
 * 1. Remove entries whose paths are in `diff.removed`
 * 2. Update entries whose paths match `diff.updated`
 * 3. Append `diff.added` entries
 *
 * Requirement 3.6: aplicar diff sin reemplazar lista completa.
 */
export function applyDiff(entries: DirEntry[], diff: DirectoryDiff): DirEntry[] {
	const removedSet = new Set(diff.removed);
	const updatedMap = new Map(diff.updated.map((e) => [e.path, e]));

	// Filter out removed entries and apply updates in a single pass
	const result: DirEntry[] = [];
	for (const entry of entries) {
		if (removedSet.has(entry.path)) {
			continue;
		}
		const updatedEntry = updatedMap.get(entry.path);
		result.push(updatedEntry ?? entry);
	}

	// Append added entries
	for (const entry of diff.added) {
		result.push(entry);
	}

	return result;
}

/**
 * Checks if metadata has changed between two entries with the same path.
 * Compares: size, modified_time, name.
 */
function hasMetadataChanged(oldEntry: DirEntry, newEntry: DirEntry): boolean {
	return (
		oldEntry.size !== newEntry.size ||
		oldEntry.modified_time !== newEntry.modified_time ||
		oldEntry.name !== newEntry.name
	);
}
