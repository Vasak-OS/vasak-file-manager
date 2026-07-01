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

export function isTextFile(entry: DirEntry): boolean {
	if (entry.is_dir) return false;
	const extension = entry.ext?.toLowerCase();
	if (!extension) return false;
	return FILE_EXTENSIONS.TEXT.includes(extension) || FILE_EXTENSIONS.CODE.includes(extension);
}

export function isAudioFile(entry: DirEntry): boolean {
	if (entry.is_dir) return false;
	const extension = entry.ext?.toLowerCase();
	return extension ? FILE_EXTENSIONS.AUDIO.includes(extension) : false;
}

export function isPdfFile(entry: DirEntry): boolean {
	if (entry.is_dir) return false;
	const extension = entry.ext?.toLowerCase();
	return extension ? FILE_EXTENSIONS.PDF.includes(extension) : false;
}
