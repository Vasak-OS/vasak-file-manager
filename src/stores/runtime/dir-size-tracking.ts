/**
 * Cuándo hay que sondear el progreso del cálculo de tamaños, y a qué aplicarlo.
 *
 * Vive aparte del store para poder probarlo: son dos decisiones chicas donde un
 * error no se ve —un temporizador que queda despertando para siempre, o un
 * progreso que se aplica a una carpeta que ya nadie está mirando— y las dos
 * pasaron por acá cuando había un `setInterval` por ruta.
 */

/** Lo que el backend informa de un cálculo en curso. */
export interface ProgresoDeCalculo {
	path: string;
	size: number;
	file_count: number;
	dir_count: number;
}

/**
 * Si el temporizador tiene que estar corriendo.
 *
 * Dos condiciones, y las dos importan: sin nada que seguir, despertar cada dos
 * segundos es puro costo; y con la ventana tapada nadie mira los tamaños que se
 * están actualizando.
 */
export function debeSondear(siguiendo: ReadonlySet<string>, oculto: boolean): boolean {
	return siguiendo.size > 0 && !oculto;
}

/**
 * Filtra lo que el backend devolvió a lo que de verdad se está siguiendo.
 *
 * El backend informa **todos** los cálculos en curso, incluidos los de carpetas
 * que ya se cerraron: aplicarlos escribiría tamaños que nadie pidió y que
 * quedarían pegados en la vista. Y un tamaño en cero es un cálculo que todavía
 * no encontró nada, no un resultado.
 */
export function progresoAplicable(
	activos: readonly ProgresoDeCalculo[],
	siguiendo: ReadonlySet<string>
): ProgresoDeCalculo[] {
	return activos.filter((calculo) => siguiendo.has(calculo.path) && calculo.size > 0);
}
