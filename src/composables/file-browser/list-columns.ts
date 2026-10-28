/**
 * Qué columnas secundarias de la lista entran en un ancho.
 *
 * El nombre siempre está; las otras tres se esconden de la más ancha y
 * prescindible a la menos —modificado, tamaño, elementos— a medida que el
 * contenedor se angosta, para que en un panel chico (cada mitad de la vista
 * dividida, una ventana angosta) no queden apretadas ni cortadas por el borde.
 *
 * Es el ancho del **contenedor**, no el de la ventana: en vista dividida cada
 * panel decide por su cuenta, y se mide con `useElementWidth` (en WebKitGTK ni
 * `matchMedia` ni `resize` avisan, memoria `webkitgtk-no-avisa-de-resize`).
 */
export interface ListColumnVisibility {
	items: boolean;
	size: boolean;
	modified: boolean;
}

/** Debajo de este ancho (px) se esconde «modificado». */
export const HIDE_MODIFIED_BELOW = 560;

/** Debajo de este ancho se esconde además «tamaño». */
export const HIDE_SIZE_BELOW = 420;

/** Debajo de este ancho se esconde además «elementos». */
export const HIDE_ITEMS_BELOW = 320;

/**
 * Las columnas que entran en `width`. Sin medida todavía
 * (`Number.POSITIVE_INFINITY`, que es lo que da `useElementWidth` al empezar)
 * entran todas: se dibuja el formato ancho de siempre.
 */
export function columnsForWidth(width: number): ListColumnVisibility {
	return {
		items: width >= HIDE_ITEMS_BELOW,
		size: width >= HIDE_SIZE_BELOW,
		modified: width >= HIDE_MODIFIED_BELOW,
	};
}
