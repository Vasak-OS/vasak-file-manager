/**
 * Un icono se pide una vez, no una vez por archivo.
 *
 * Cada fila de la lista dibuja su icono con `getFileIcon`, que termina en un
 * `invoke` al backend y devuelve la imagen **en base64**. Pero `getFileIcon`
 * sólo puede contestar ocho nombres distintos —carpeta, imagen, video, audio,
 * código, comprimido, texto y el genérico—, así que abrir un directorio de
 * 3.585 archivos como `/usr/bin` eran 3.585 viajes por el puente para pedir
 * cuatro iconos, y 3.585 copias de la misma cadena en memoria.
 *
 * Lo que se guarda es **la promesa y no el valor**, y ésa es la parte que
 * importa: las filas se montan todas en el mismo tic, así que cuando la
 * segunda pregunta, la primera todavía no contestó. Una caché de valores no
 * tendría nada guardado todavía y dejaría pasar las 3.585 igual; una de
 * promesas hace que las 3.584 restantes esperen la misma.
 *
 * Si el pedido falla se olvida, para que el siguiente vuelva a intentar en vez
 * de quedar con un error pegado hasta que cambie el tema.
 */
export interface CacheDeIconos {
	/** El icono de ese nombre, pidiéndolo sólo si no se pidió antes. */
	pedir(nombre: string): Promise<string>;
	/** Tira lo guardado. Va cuando cambia el tema de iconos. */
	olvidar(): void;
	/** Cuántos nombres distintos hay guardados. Para las pruebas. */
	readonly guardados: number;
}

export function crearCacheDeIconos(
	pedirAlBackend: (nombre: string) => Promise<string>
): CacheDeIconos {
	const pendientes = new Map<string, Promise<string>>();

	return {
		pedir(nombre: string): Promise<string> {
			const guardado = pendientes.get(nombre);
			if (guardado) return guardado;

			const pedido = pedirAlBackend(nombre).catch((error) => {
				pendientes.delete(nombre);
				throw error;
			});

			pendientes.set(nombre, pedido);
			return pedido;
		},

		olvidar(): void {
			pendientes.clear();
		},

		get guardados(): number {
			return pendientes.size;
		},
	};
}
