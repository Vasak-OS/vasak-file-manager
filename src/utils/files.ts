import { FILE_EXTENSIONS } from '@/constants/file-extensions';
import type { DirEntry } from '@/types/dir-entry';

export function isImageFile(entry: DirEntry): boolean {
	if (entry.is_dir) return false;
	const extension = entry.ext?.toLowerCase();
	return extension ? FILE_EXTENSIONS.IMAGE.includes(extension) : false;
}

/**
 * Desde qué tamaño en disco una imagen de la grilla pasa por miniatura.
 *
 * WebKit decodifica a tamaño real aunque la tarjeta mida 120 px, y el tamaño
 * decodificado no se parece al del archivo (un fondo de 2,3 MB son más de cien
 * megas de píxeles). Abajo de esto el archivo es un icono o una foto chica y
 * cargarlo directo es más barato que pedir una miniatura.
 */
const MIN_THUMBNAIL_BYTES = 256 * 1024;

/** Las que el backend sabe achicar (`video_thumbnail.rs`); SVG se dibuja a la medida. */
const THUMBNAIL_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']);

export function needsThumbnail(entry: DirEntry): boolean {
	if (!isImageFile(entry) || entry.size < MIN_THUMBNAIL_BYTES) return false;
	return THUMBNAIL_EXTENSIONS.has(entry.ext?.toLowerCase() ?? '');
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
