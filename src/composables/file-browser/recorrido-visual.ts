import type { DirEntry } from '@/types/dir-entry';

/**
 * Moverse con las flechas sin mirar la pantalla.
 *
 * La navegación averiguaba qué entrada estaba «abajo» midiendo rectángulos:
 * pedía todos los elementos con `[data-entry-path]` y comparaba
 * `getBoundingClientRect()`. Eso funciona mientras el directorio entero esté
 * dibujado, y deja de funcionar en cuanto se virtualice la lista — con veinte
 * filas en el DOM, la fila veintiuno no existe y las flechas se quedan ahí.
 *
 * Acá el recorrido se calcula sobre los datos. Lo único que hace falta saber de
 * la pantalla es en cuántas columnas se acomoda cada sección, que es un número
 * por sección y no una medición por entrada.
 *
 * Las secciones existen por la vista de cuadrícula, que agrupa en carpetas,
 * imágenes, videos y el resto, cada grupo con su propia cantidad de columnas.
 * La vista de lista es el caso de una sola sección de una sola columna, y con
 * eso el movimiento vertical se vuelve «la anterior» y «la siguiente» sin
 * necesidad de otro camino.
 */
export interface SeccionVisual {
	/** Las entradas de esta sección, en el orden en que se ven. */
	entradas: DirEntry[];
	/** Cuántas entran por fila. Siempre uno o más. */
	columnas: number;
}

/** Dónde cayó una entrada dentro del recorrido. */
interface Ubicacion {
	seccion: number;
	indice: number;
}

function ubicar(secciones: SeccionVisual[], ruta: string): Ubicacion | null {
	for (let seccion = 0; seccion < secciones.length; seccion++) {
		const indice = secciones[seccion].entradas.findIndex((entrada) => entrada.path === ruta);
		if (indice !== -1) return { seccion, indice };
	}
	return null;
}

/** Cuántas columnas tiene la sección, nunca menos de una. */
function columnasDe(seccion: SeccionVisual): number {
	return Math.max(1, Math.floor(seccion.columnas) || 1);
}

/**
 * Todas las entradas en el orden en que se ven.
 *
 * No es el orden del arreglo original: la cuadrícula agrupa, así que primero
 * van las carpetas, después las imágenes, y así. Es el orden que siguen las
 * flechas izquierda y derecha.
 */
export function ordenVisual(secciones: SeccionVisual[]): DirEntry[] {
	return secciones.flatMap((seccion) => seccion.entradas);
}

/**
 * La entrada anterior o siguiente en el orden en que se ven.
 *
 * Sin nada seleccionado se arranca por un extremo: por la primera si se va
 * hacia adelante, por la última si se va hacia atrás. En los bordes no se da la
 * vuelta — llegar al final y volver al principio con una flecha desorienta.
 */
export function vecinoLineal(
	secciones: SeccionVisual[],
	rutaActual: string | null,
	direccion: 'anterior' | 'siguiente'
): DirEntry | null {
	const todas = ordenVisual(secciones);
	if (todas.length === 0) return null;

	if (rutaActual === null) {
		return direccion === 'siguiente' ? todas[0] : todas[todas.length - 1];
	}

	const indice = todas.findIndex((entrada) => entrada.path === rutaActual);
	if (indice === -1) {
		return direccion === 'siguiente' ? todas[0] : todas[todas.length - 1];
	}

	const destino = direccion === 'siguiente' ? indice + 1 : indice - 1;
	if (destino < 0 || destino >= todas.length) return null;

	return todas[destino];
}

/**
 * La entrada de arriba o de abajo.
 *
 * Dentro de una sección es sumar o restar el ancho de la fila. Cuando eso se
 * sale de la sección se pasa a la de al lado **conservando la columna**, que es
 * lo que hacía la versión que medía rectángulos —buscaba la más cercana en
 * horizontal— y lo que espera quien mira la pantalla: bajar desde la tercera
 * carpeta cae en la tercera imagen, no en la primera.
 *
 * Si la fila de destino es más corta que la columna actual, se cae en la última
 * de esa fila. Es lo mismo que pasa al bajar a una fila incompleta dentro de la
 * misma sección.
 */
export function vecinoVertical(
	secciones: SeccionVisual[],
	rutaActual: string | null,
	direccion: 'arriba' | 'abajo'
): DirEntry | null {
	const conEntradas = secciones.filter((seccion) => seccion.entradas.length > 0);
	if (conEntradas.length === 0) return null;

	if (rutaActual === null) {
		const todas = ordenVisual(conEntradas);
		return direccion === 'abajo' ? todas[0] : todas[todas.length - 1];
	}

	const donde = ubicar(conEntradas, rutaActual);
	if (!donde) {
		const todas = ordenVisual(conEntradas);
		return direccion === 'abajo' ? todas[0] : todas[todas.length - 1];
	}

	const seccion = conEntradas[donde.seccion];
	const columnas = columnasDe(seccion);
	const columna = donde.indice % columnas;
	const filaActual = Math.floor(donde.indice / columnas);
	const ultimaFila = Math.floor((seccion.entradas.length - 1) / columnas);

	// Hay fila hacia ese lado dentro de la sección: se cae en ella, y si es una
	// fila incompleta, en la última que tenga. Bajar desde la columna del medio
	// a una última fila de un solo elemento tiene que caer en ese elemento y no
	// saltarse la sección entera — que es lo que hacía la versión que medía,
	// buscando la más cercana en horizontal.
	if (direccion === 'abajo' && filaActual < ultimaFila) {
		return seccion.entradas[Math.min(donde.indice + columnas, seccion.entradas.length - 1)];
	}

	if (direccion === 'arriba' && filaActual > 0) {
		return seccion.entradas[donde.indice - columnas];
	}

	// Se salió de la sección: se busca la de al lado en esa dirección.
	const siguiente = direccion === 'abajo' ? donde.seccion + 1 : donde.seccion - 1;
	if (siguiente < 0 || siguiente >= conEntradas.length) {
		// Es el borde de arriba o el de abajo de todo. No se da la vuelta.
		return null;
	}

	const vecina = conEntradas[siguiente];
	const columnasVecina = columnasDe(vecina);

	// La columna se recorta al ancho de la sección vecina antes de nada. Sin
	// esto, viniendo de una sección más ancha que la de al lado, la columna
	// sobrante caía en la **fila siguiente** de la vecina en vez de en la
	// primera: bajando desde la cuarta de cuatro columnas a una sección de dos,
	// el índice 3 es la segunda fila.
	const columnaVecina = Math.min(columna, columnasVecina - 1);

	if (direccion === 'abajo') {
		// La primera fila de la sección de abajo, en la misma columna.
		return vecina.entradas[Math.min(columnaVecina, vecina.entradas.length - 1)];
	}

	// La última fila de la sección de arriba, en la misma columna.
	const inicioUltimaFila =
		Math.floor((vecina.entradas.length - 1) / columnasVecina) * columnasVecina;
	return vecina.entradas[Math.min(inicioUltimaFila + columnaVecina, vecina.entradas.length - 1)];
}
