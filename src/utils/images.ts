import { convertFileSrc } from '@tauri-apps/api/core';
import { getIconSource } from '@vasakgroup/plugin-vicons';
import type { DirEntry } from '@/types/dir-entry';
import { crearCacheDeIconos } from '@/utils/cache-de-iconos';
import { nombreDeIcono, olvidarNombres } from '@/utils/iconos-de-entrada';

const cacheDeIconos = crearCacheDeIconos(getIconSource);

/**
 * Tira los iconos guardados.
 *
 * Va cuando cambia el tema, y **antes** de que se vuelvan a pedir: si se
 * vaciara después, el redibujado tomaría los del tema viejo de la caché y el
 * cambio de tema no se vería hasta el siguiente directorio.
 *
 * Son dos cosas las que se olvidan: la imagen de cada nombre, y **qué nombre le
 * toca a cada tipo**. Lo segundo también depende del tema —la cadena se recorre
 * hasta el primero que el tema tenga— así que dejarlo guardado haría que un tema
 * con más iconos siguiera dibujando los genéricos del anterior.
 */
export function olvidarIconos(): void {
	cacheDeIconos.olvidar();
	olvidarNombres();
}

export async function getFileIcon(entry: DirEntry): Promise<string> {
	return await cacheDeIconos.pedir(await nombreDeIcono(entry));
}

export function getImageSrc(entry: DirEntry): string {
	return convertFileSrc(entry.path);
}
