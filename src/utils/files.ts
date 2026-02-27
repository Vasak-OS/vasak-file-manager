import { FILE_EXTENSIONS } from '@/constants/file-extensions';
import type { DirEntry } from '@/types/dir-entry';

export function isImageFile(entry: DirEntry): boolean {
	if (entry.is_dir) return false;
	const extension = entry.ext?.toLowerCase();
	return extension ? FILE_EXTENSIONS.IMAGE.includes(extension) : false;
}

export function isVideoFile(entry: DirEntry): boolean {
	if (entry.is_dir) return false;
	const extension = entry.ext?.toLowerCase();
	return extension ? FILE_EXTENSIONS.VIDEO.includes(extension) : false;
}
