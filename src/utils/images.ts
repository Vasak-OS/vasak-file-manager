import { convertFileSrc } from '@tauri-apps/api/core';
import type { DirEntry } from '@/types/dir-entry';

/**
 * La ruta de la imagen de una entrada, para verla de verdad.
 *
 * Es lo único que queda acá: lo de resolver **iconos** se fue entero. La caché
 * por nombre, la de la imagen de cada nombre y el descartar la respuesta que
 * llega tarde los hace `ThemeIcon`, y encima memoriza entre componentes y
 * comparte el pedido en vuelo, que la copia de acá no hacía: diez filas con el
 * mismo icono lo pedían diez veces.
 */
export function getImageSrc(entry: DirEntry): string {
	return convertFileSrc(entry.path);
}
