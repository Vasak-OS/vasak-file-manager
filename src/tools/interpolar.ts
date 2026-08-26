/**
 * Interpolación de textos traducidos.
 *
 * El `t()` del plugin toma una sola clave y **no interpola**, así que el valor se
 * mete después. La convención del escritorio es el marcador `{0}`, `{1}`…
 *
 * # Por qué no `replace` a secas
 *
 * `String.prototype.replace` interpreta `$&`, `$$`, `` $` `` y `$'` **en la cadena
 * de reemplazo**. En un gestor de archivos eso no es teórico: los nombres de
 * archivo los elige la persona, y uno llamado «Rock $& Roll.mp3» aparecería como
 * «Rock {0} Roll.mp3», mientras que uno con `$'` **perdería el texto que viene
 * después**.
 *
 * `split` y `join` no interpretan nada, reemplazan todas las apariciones, y no
 * dependen de que el objetivo de TypeScript sea ES2021 —que es lo que pide
 * `replaceAll`, y este repo compila más abajo—.
 */
export function interpolar(plantilla: string, ...valores: unknown[]): string {
	// Una sola pasada, y con función de reemplazo.
	//
	// Reemplazar marcador por marcador tenía un agujero: si un valor contiene el
	// texto de otro marcador, la pasada siguiente lo reemplazaba. Con un nombre de
	// archivo llamado «{1}», `interpolar('Archivo: {0}', '{1}', 'x')` devolvía
	// «Archivo: x». En un gestor de archivos el valor es justamente algo que la
	// persona eligió, así que no es un caso hipotético.
	//
	// La función de reemplazo además no interpreta `$&`, `$$`, `` $` `` ni `$'`,
	// que es lo que hace `replace` con una cadena: «Rock $& Roll.mp3» salía como
	// «Rock {0} Roll.mp3».
	return plantilla.replace(/\{(\d+)\}/g, (completo, indice: string) => {
		const valor = valores[Number(indice)];
		// Un marcador sin valor se deja como está, en lugar de decir «undefined».
		return valor === undefined ? completo : String(valor);
	});
}

/**
 * La clave que corresponde a una cantidad.
 *
 * Dos claves con sufijo `One`/`Other` en lugar de una sola: sin esto se termina
 * mostrando «1 elementos».
 */
export function claveSegunCantidad(base: string, cantidad: number): string {
	return cantidad === 1 ? `${base}One` : `${base}Other`;
}
