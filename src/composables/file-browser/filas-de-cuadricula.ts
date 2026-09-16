import type { DirEntry } from '@/types/dir-entry';

/**
 * Cortar la cuadrícula en filas, para poder dibujar sólo las que se ven.
 *
 * La vista de cuadrícula son cuatro rejillas con encabezado pegajoso, ancho
 * mínimo y alto de tarjeta propios. Virtualizar tarjeta por tarjeta obligaría a
 * calcularle la posición a cada una —el modo grilla del desplazador pide el
 * tamaño exacto y pierde el `1fr` del CSS—, así que se virtualiza por filas:
 * cada elemento del desplazador es una fila entera y adentro sigue siendo una
 * rejilla de CSS.
 *
 * Esto es la aritmética de eso, aparte para poder probarla: es lo que decide
 * dónde se corta cada fila, y equivocarse deja tarjetas que se pisan o huecos.
 */

/** La separación entre tarjetas, en píxeles. Es el `gap-3` del CSS. */
export const SEPARACION_PX = 12;

/** Una fila de la cuadrícula: las tarjetas que entran de lado a lado. */
export interface Fila {
	/** Cambia cuando cambia el contenido de la fila, que es cuando hay que rehacerla. */
	clave: string;
	entradas: DirEntry[];
}

/**
 * Cuántas tarjetas entran a lo ancho.
 *
 * Es la misma cuenta que resuelve `repeat(auto-fill, minmax(min, 1fr))`, y se
 * hace acá en vez de preguntársela al navegador porque con la cuadrícula
 * virtualizada ya no hay una rejilla entera que medir. Como este número es
 * además el que se le escribe a cada fila, no quedan dos fuentes que puedan
 * discrepar.
 *
 * Nunca menos de una: con la sección oculta o todavía sin medir, el ancho es
 * cero, y una fila de cero tarjetas sería un bucle infinito al cortar.
 */
export function columnasQueEntran(ancho: number, minimo: number): number {
	if (!Number.isFinite(ancho) || ancho <= 0 || minimo <= 0) return 1;

	return Math.max(1, Math.floor((ancho + SEPARACION_PX) / (minimo + SEPARACION_PX)));
}

/** Corta las entradas en filas de `porFila`. */
export function enFilas(entradas: DirEntry[], porFila: number): Fila[] {
	const ancho = Math.max(1, Math.floor(porFila) || 1);
	const filas: Fila[] = [];

	for (let i = 0; i < entradas.length; i += ancho) {
		const deLaFila = entradas.slice(i, i + ancho);
		filas.push({ clave: deLaFila[0].path, entradas: deLaFila });
	}

	return filas;
}
