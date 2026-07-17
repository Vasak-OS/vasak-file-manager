import { invoke } from '@tauri-apps/api/core';
import { ref } from 'vue';
import { FILE_EXTENSIONS } from '@/constants/file-extensions';
import type { DirEntry } from '@/types/dir-entry';

export interface ArchiveEntry {
	name: string;
	path: string;
	size: number;
	compressedSize: number;
	isDir: boolean;
	modifiedTime: number;
}

/** Supported archive extensions that can be navigated */
const NAVIGABLE_ARCHIVE_EXTENSIONS = ['zip', 'tar.gz', '7z', 'gz', 'tar'];

/**
 * Check if a file entry is a navigable archive based on its extension.
 */
export function isNavigableArchive(entry: DirEntry): boolean {
	if (!entry.is_file) return false;
	const ext = entry.ext?.toLowerCase();
	if (!ext) return false;

	// Handle .tar.gz compound extension
	if (entry.name.toLowerCase().endsWith('.tar.gz')) return true;

	return NAVIGABLE_ARCHIVE_EXTENSIONS.includes(ext);
}

/**
 * Composable for navigating inside archive files.
 * Provides methods to list archive contents and convert them to DirEntry format.
 */
export function useArchiveNavigation() {
	const isLoadingArchive = ref(false);
	const archiveError = ref<string | null>(null);

	/**
	 * List the contents of an archive file at a given internal path.
	 * Returns DirEntry[] compatible with the file browser.
	 */
	async function listArchiveContents(
		archivePath: string,
		internalPath = ''
	): Promise<{ entries: DirEntry[]; error: string | null }> {
		isLoadingArchive.value = true;
		archiveError.value = null;

		try {
			const entries = await invoke<ArchiveEntry[]>('list_archive_contents', {
				path: archivePath,
				internalPath,
			});

			// Convert ArchiveEntry to DirEntry format for the file browser
			return {
				entries: entries.map((entry) => archiveEntryToDirEntry(entry, archivePath)),
				error: null,
			};
		} catch (err: unknown) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			archiveError.value = errorMessage;
			return { entries: [], error: errorMessage };
		} finally {
			isLoadingArchive.value = false;
		}
	}

	/**
	 * Attempt to navigate into an archive. Returns the entries if successful,
	 * or null if the archive cannot be read.
	 */
	async function openArchive(archivePath: string): Promise<DirEntry[] | null> {
		const result = await listArchiveContents(archivePath, '');
		if (result.error) return null;
		return result.entries;
	}

	return {
		isLoadingArchive,
		archiveError,
		listArchiveContents,
		openArchive,
	};
}

/**
 * Convert an ArchiveEntry from the backend to a DirEntry compatible with the file browser.
 */
function archiveEntryToDirEntry(entry: ArchiveEntry, archivePath: string): DirEntry {
	const ext = entry.isDir ? null : getExtension(entry.name);
	const mime = ext ? guessMimeFromExt(ext) : null;

	return {
		name: entry.name,
		path: `${archivePath}::${entry.path}`,
		ext,
		size: entry.size,
		item_count: entry.isDir ? null : null,
		modified_time: entry.modifiedTime,
		accessed_time: entry.modifiedTime,
		created_time: entry.modifiedTime,
		mime,
		is_file: !entry.isDir,
		is_dir: entry.isDir,
		is_symlink: false,
		is_hidden: entry.name.startsWith('.'),
	};
}

function getExtension(name: string): string | null {
	const lastDot = name.lastIndexOf('.');
	if (lastDot === -1 || lastDot === 0) return null;
	return name.slice(lastDot + 1).toLowerCase();
}

function guessMimeFromExt(ext: string): string | null {
	if (FILE_EXTENSIONS.IMAGE.includes(ext)) return `image/${ext}`;
	if (FILE_EXTENSIONS.VIDEO.includes(ext)) return `video/${ext}`;
	if (FILE_EXTENSIONS.AUDIO.includes(ext)) return `audio/${ext}`;
	if (FILE_EXTENSIONS.TEXT.includes(ext)) return 'text/plain';
	if (FILE_EXTENSIONS.CODE.includes(ext)) return 'text/plain';
	if (FILE_EXTENSIONS.PDF.includes(ext)) return 'application/pdf';
	return null;
}
