/**
 * Lo que decide el menú del clic derecho sobre un campo de texto.
 *
 * Vive fuera del componente para poder probarse sin una ventana: copiar, cortar
 * y pegar tienen casos en los que la respuesta correcta es «no tocar nada», y
 * esos son justamente los que sólo se ven cuando el sistema falla —el
 * portapapeles vacío, la escritura que no llega—. Un descuido ahí no se ve en
 * pantalla: se ve cuando alguien perdió lo que había escrito.
 */

/**
 * Los tipos de `input` sobre los que se puede leer y reemplazar la selección.
 *
 * Los deslizadores, las casillas y los interruptores también son `input`, y no
 * tienen texto que copiar. `number` y `email` tampoco entran, aunque lo
 * parezcan: el estándar no les da selección, y `selectionStart`, `setRangeText`
 * y `select()` tiran `InvalidStateError` sobre ellos. El menú se abriría para
 * romperse al elegir cualquier cosa.
 */
export const TIPOS_CON_TEXTO = ['text', 'search', 'url', 'tel', 'password'];

export type CampoDeTexto = HTMLInputElement | HTMLTextAreaElement;

/** El portapapeles del sistema, visto desde acá: leer puede no traer nada. */
export interface Portapapeles {
	leer: () => Promise<string | null>;
	escribir: (texto: string) => Promise<void>;
}

export type AccionDeTexto = 'copiar' | 'cortar' | 'pegar' | 'seleccionar-todo';

const ACCIONES: readonly string[] = ['copiar', 'cortar', 'pegar', 'seleccionar-todo'];

export const esAccionDeTexto = (id: string): id is AccionDeTexto => ACCIONES.includes(id);

export const campoDeTexto = (elemento: EventTarget | null): CampoDeTexto | null => {
	if (elemento instanceof HTMLTextAreaElement) return elemento;

	if (elemento instanceof HTMLInputElement && TIPOS_CON_TEXTO.includes(elemento.type)) {
		return elemento;
	}

	return null;
};

/**
 * Reemplaza la selección del campo respetando a Vue.
 *
 * `setRangeText` cambia el valor del elemento sin que `v-model` se entere, así
 * que hay que avisar con un evento `input`: sin eso lo pegado se ve en pantalla
 * y se pierde al guardar.
 */
export const insertar = (campo: CampoDeTexto, texto: string) => {
	const desde = campo.selectionStart ?? campo.value.length;
	const hasta = campo.selectionEnd ?? campo.value.length;

	campo.focus();
	campo.setRangeText(texto, desde, hasta, 'end');
	campo.dispatchEvent(new Event('input', { bubbles: true }));
};

/** Devuelve si el texto llegó de verdad al portapapeles. */
export const copiar = async (portapapeles: Portapapeles, texto: string): Promise<boolean> => {
	try {
		await portapapeles.escribir(texto);
		return true;
	} catch (error) {
		console.warn('No se pudo copiar al portapapeles:', error);
		return false;
	}
};

export const ejecutarAccion = async (
	accion: AccionDeTexto,
	campo: CampoDeTexto,
	seleccion: string,
	portapapeles: Portapapeles
): Promise<void> => {
	if (accion === 'copiar') {
		await copiar(portapapeles, seleccion);
		return;
	}

	if (accion === 'cortar') {
		// Cortar es copiar y después borrar. Si la copia no llegó al portapapeles
		// no hay «después»: borrar ahí sería perder el texto sin dejar copia en
		// ningún lado. Se queda como estaba, que siempre se puede volver a probar.
		if (await copiar(portapapeles, seleccion)) insertar(campo, '');
		return;
	}

	if (accion === 'pegar') {
		try {
			const texto = await portapapeles.leer();

			// Con el portapapeles vacío no hay nada que pegar. Insertar la cadena
			// vacía sería reemplazar lo seleccionado por nada, o sea borrarlo.
			if (texto) insertar(campo, texto);
		} catch (error) {
			console.warn('No se pudo leer el portapapeles:', error);
		}
		return;
	}

	campo.focus();
	campo.select();
};
