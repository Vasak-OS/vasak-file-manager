import { convertFileSrc } from '@tauri-apps/api/core';
import { FILE_EXTENSIONS } from '@/constants/file-extensions';
import type { DirEntry } from '@/types/dir-entry';
import { getIconSource } from '@vasakgroup/plugin-vicons';

export async function getFileIcon(entry: DirEntry): Promise<string> {
	if (entry.is_dir) return await getIconSource('folder');

	const extension = entry.ext?.toLowerCase();
	if (!extension) return await getIconSource('application-rtf');

	if (FILE_EXTENSIONS.IMAGE.includes(extension)) return await getIconSource('image-x-generic');
	if (FILE_EXTENSIONS.VIDEO.includes(extension)) return await getIconSource('video-x-generic');
	if (FILE_EXTENSIONS.AUDIO.includes(extension)) return await getIconSource('audio-x-generic');
	if (FILE_EXTENSIONS.CODE.includes(extension)) return await getIconSource('application-vnd.nokia.xml.qt.resource');
	if (FILE_EXTENSIONS.ARCHIVE.includes(extension)) await getIconSource('application-x-archive');
	if (FILE_EXTENSIONS.TEXT.includes(extension)) await getIconSource('text-x-generic');

	return await getIconSource('application-rtf');
}

export function getImageSrc(entry: DirEntry): string {
	return convertFileSrc(entry.path);
}
