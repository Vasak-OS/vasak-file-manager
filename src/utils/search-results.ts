import { SEARCH_CONSTANTS } from '@/constants/search';
import type { DirEntry } from '@/types/dir-entry';

/**
 * Limits the number of visible search results to the configured maximum (500).
 * Results beyond the limit are discarded.
 */
export function limitSearchResults(results: DirEntry[]): DirEntry[] {
	return results.slice(0, SEARCH_CONSTANTS.MAX_RESULT_LIMIT);
}

/**
 * Extracts the drive root / mount point from a file path.
 *
 * - Windows paths like `C:\Users\...` → `C:/`
 * - Unix paths like `/home/user/...` → `/home`
 * - Root-only paths like `/` → `/`
 */
export function getDriveRoot(path: string): string {
	// Windows drive letter (e.g. C:\...)
	if (/^[a-zA-Z]:/.test(path)) {
		return `${path.substring(0, 2).toUpperCase()}/`;
	}

	const parts = path.split('/').filter(Boolean);

	if (parts.length > 0) {
		return `/${parts[0]}`;
	}

	return '/';
}

export interface SearchResultGroup {
	driveRoot: string;
	entries: DirEntry[];
}

/**
 * Groups search results by their disk root / mount point.
 * Each result is assigned to the group corresponding to its root.
 * The union of all groups equals the original set.
 */
export function groupResultsByDriveRoot(results: DirEntry[]): SearchResultGroup[] {
	const groups = new Map<string, DirEntry[]>();

	for (const entry of results) {
		const driveRoot = getDriveRoot(entry.path);
		const existing = groups.get(driveRoot);

		if (existing) {
			existing.push(entry);
		} else {
			groups.set(driveRoot, [entry]);
		}
	}

	return Array.from(groups.entries())
		.sort(([rootA], [rootB]) => rootA.localeCompare(rootB))
		.map(([driveRoot, entries]) => ({
			driveRoot,
			entries,
		}));
}
