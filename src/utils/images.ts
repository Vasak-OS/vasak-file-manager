import { convertFileSrc } from '@tauri-apps/api/core';
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { FILE_EXTENSIONS } from '@/constants/file-extensions';
import type { DirEntry } from '@/types/dir-entry';
import { crearCacheDeIconos } from '@/utils/cache-de-iconos';

/**
 * Qué icono le toca a una entrada.
 *
 * Vive aparte de pedirlo para poder probarlo: son ocho nombres posibles y las
 * reglas que los eligen —que la carpeta gane sobre cualquier extensión, que lo
 * sin extensión caiga en el genérico— no necesitan ni backend ni tema.
 */
export function nombreDeIcono(entry: DirEntry): string {
	if (entry.is_dir) return 'folder';

	const extension = entry.ext?.toLowerCase();
	if (!extension) return 'application-rtf';

	if (FILE_EXTENSIONS.IMAGE.includes(extension)) return 'image-x-generic';
	if (FILE_EXTENSIONS.VIDEO.includes(extension)) return 'video-x-generic';
	if (FILE_EXTENSIONS.AUDIO.includes(extension)) return 'audio-x-generic';
	if (FILE_EXTENSIONS.CODE.includes(extension)) return 'application-vnd.nokia.xml.qt.resource';
	if (FILE_EXTENSIONS.ARCHIVE.includes(extension)) return 'application-x-archive';
	if (FILE_EXTENSIONS.TEXT.includes(extension)) return 'text-x-generic';

	return 'application-rtf';
}

const cacheDeIconos = crearCacheDeIconos(getIconSource);

/**
 * Tira los iconos guardados.
 *
 * Va cuando cambia el tema, y **antes** de que se vuelvan a pedir: si se
 * vaciara después, el redibujado tomaría los del tema viejo de la caché y el
 * cambio de tema no se vería hasta el siguiente directorio.
 */
export function olvidarIconos(): void {
	cacheDeIconos.olvidar();
}

export async function getFileIcon(entry: DirEntry): Promise<string> {
	return await cacheDeIconos.pedir(nombreDeIcono(entry));
}

export function getImageSrc(entry: DirEntry): string {
	return convertFileSrc(entry.path);
}
