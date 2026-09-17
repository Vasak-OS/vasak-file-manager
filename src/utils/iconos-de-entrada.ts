import { invoke } from '@tauri-apps/api/core';
import { hasIcon } from '@vasakgroup/plugin-vicons';
import type { DirEntry } from '@/types/dir-entry';

/**
 * Con qué se dibuja cada entrada.
 *
 * Hasta acá esto eran **ocho nombres**: carpeta, imagen, video, audio, código,
 * comprimido, texto y una hoja en blanco para todo lo demás. La hoja en blanco
 * se llevaba casi todo —un PDF, un `.deb`, una tipografía, un ejecutable y un
 * archivo sin extensión salían los cinco iguales— mientras el tema de VasakOS
 * tiene **1478** iconos de tipo de archivo esperando que alguien los pida.
 *
 * Ahora el nombre sale del tipo de contenido que resuelve la base de datos del
 * sistema, y el orden en que probarlos lo arma GIO, que es quien sabe que un
 * `.py3` es un `.py` y que un `.deb` es un paquete.
 *
 * ## Tres preguntas, y ninguna por archivo
 *
 * 1. **Qué tipo es.** Para casi todo ya vino en el listado, que lo saca del
 *    nombre sin tocar el disco. Lo que no tiene extensión llega sin resolver y
 *    hay que preguntarlo aparte, porque mirar adentro cuesta 150 µs por archivo
 *    y no se puede repartir entre los núcleos: GIO lo hace con un candado
 *    global. Por eso se pregunta **sólo por lo que se está dibujando** —con las
 *    vistas virtualizadas, unas sesenta entradas— y las preguntas de un mismo
 *    tic se juntan en un solo viaje.
 * 2. **Con qué iconos se puede dibujar ese tipo**, en orden. Una vez por tipo.
 * 3. **Cuál de ellos tiene el tema.** Una vez por nombre.
 *
 * ## Por qué hay que preguntar si el icono existe
 *
 * `getIconSource` **nunca falla** por un nombre que no está: cuando GTK no lo
 * encuentra devuelve `image-missing` —el cuadrito de imagen rota— como si fuera
 * el icono pedido, y quien llama recibe un base64 perfectamente válido e
 * indistinguible del bueno. Por eso la cadena se recorre con `hasIcon` y no
 * pidiendo a ver qué sale.
 *
 * Lo que se guarda en los tres casos es la **promesa** y no el valor, igual que
 * en `cache-de-iconos` y por el mismo motivo: las filas se montan todas en el
 * mismo tic, así que cuando la segunda pregunta, la primera todavía no contestó.
 */

/** Lo que se dibuja para una carpeta, sin preguntarle nada a nadie. */
export const CARPETA = 'folder';

/** El último recurso, el mismo que el backend pone al final de cada cadena. */
export const GENERICO = 'application-x-generic';

/**
 * Lo que contesta el sistema cuando con el nombre no le alcanza.
 *
 * Es la señal de que hay que mirar adentro del archivo, y también lo que se le
 * supone a una entrada que llegó sin tipo ninguno.
 */
export const SIN_RESOLVER = 'application/octet-stream';

export interface ResolutorDeIconos {
	/**
	 * El nombre del icono de esa entrada.
	 *
	 * No falla nunca: si el backend no contesta, cae en el genérico. Quien
	 * llama dibuja lo que reciba, y un rechazo acá termina en una fila **sin
	 * icono** —`useReactiveIcon` convierte el error en una cadena vacía—.
	 *
	 * Que no falle hacia afuera no quiere decir que se olvide el error: adentro
	 * las cachés sí lo ven y tiran el pedido que falló, para que el siguiente
	 * vuelva a intentar en vez de quedar con el genérico pegado.
	 */
	nombreDeIcono(entry: DirEntry): Promise<string>;
	/** Tira lo resuelto. Va cuando cambia el tema de iconos. */
	olvidar(): void;
	/** Cuántos tipos distintos hay resueltos. Para las pruebas. */
	readonly guardados: number;
}

export function crearResolutorDeIconos(opciones: {
	/** El tipo de un archivo que el listado no pudo resolver, mirando adentro. */
	tipoDelArchivo: (ruta: string) => Promise<string>;
	/** Los nombres con que se puede dibujar ese tipo, del preciso al genérico. */
	cadenaDelTipo: (tipo: string) => Promise<string[]>;
	/** Si el tema puede dibujar ese nombre. */
	tieneIcono: (nombre: string) => Promise<boolean>;
}): ResolutorDeIconos {
	const elegidos = new Map<string, Promise<string>>();

	async function primeroDisponible(nombres: string[]): Promise<string> {
		for (const nombre of nombres) {
			if (await opciones.tieneIcono(nombre)) return nombre;
		}

		// Ninguno estaba. Devolver el genérico igual —y no una cadena vacía—
		// deja que sea el tema quien decida qué dibujar, que es lo que hacía
		// antes de todo esto.
		return GENERICO;
	}

	function porElTipo(tipo: string): Promise<string> {
		const guardado = elegidos.get(tipo);
		if (guardado) return guardado;

		// Se borra **este** pedido y no lo que haya en la clave: si entre medio
		// alguien llamó a `olvidar()` y otro ya resolvió el mismo tipo, lo
		// guardado es el pedido nuevo.
		const pedido: Promise<string> = opciones
			.cadenaDelTipo(tipo)
			.then(primeroDisponible)
			.catch((error) => {
				if (elegidos.get(tipo) === pedido) elegidos.delete(tipo);
				throw error;
			});

		elegidos.set(tipo, pedido);
		return pedido;
	}

	return {
		nombreDeIcono(entry: DirEntry): Promise<string> {
			// Una carpeta no pregunta nada: su icono no depende del contenido, y
			// preguntarlo sería un viaje por entrada para contestar lo mismo.
			if (entry.is_dir) return Promise.resolve(CARPETA);

			const delListado = entry.mime ?? SIN_RESOLVER;

			if (delListado !== SIN_RESOLVER) return porElTipo(delListado).catch(() => GENERICO);

			// Sin extensión que valga: hay que mirar adentro. Es el único caso que
			// cuesta una pregunta por archivo, y el motivo de que se haga acá
			// —cuando la fila se dibuja— y no al abrir la carpeta.
			return opciones
				.tipoDelArchivo(entry.path)
				.then(porElTipo)
				.catch(() => GENERICO);
		},

		olvidar(): void {
			elegidos.clear();
		},

		get guardados(): number {
			return elegidos.size;
		},
	};
}

/**
 * Junta en un solo viaje las rutas que se preguntan en el mismo tic.
 *
 * Al desplazar entran filas de a muchas y todas preguntan a la vez. Sin esto
 * serían sesenta `invoke` por pantalla; con esto, uno.
 */
export interface PreguntonDeTipos {
	/** El tipo de ese archivo, mirando adentro. */
	tipoDelArchivo(ruta: string): Promise<string>;
	/** Cuántas rutas distintas hay resueltas. Para las pruebas. */
	readonly guardados: number;
}

export function crearPreguntonDeTipos(
	pedirAlBackend: (rutas: string[]) => Promise<(string | null)[]>
): PreguntonDeTipos {
	const resueltos = new Map<string, Promise<string>>();

	/** Las rutas que se acumularon en este tic. */
	let cola: string[] = [];

	/** La respuesta de la tanda abierta, o nada si no hay ninguna abierta. */
	let tanda: Promise<(string | null)[]> | null = null;

	function encolar(ruta: string): Promise<string> {
		if (!tanda) {
			tanda = new Promise<(string | null)[]>((listo, falla) => {
				// Al final del tic ya preguntaron todas las filas que se estaban
				// dibujando, así que la cola está completa.
				queueMicrotask(() => {
					const rutas = cola;
					cola = [];
					tanda = null;
					pedirAlBackend(rutas).then(listo, falla);
				});
			});
		}

		// La posición se toma antes de encolar y la respuesta viene en el mismo
		// orden, que es lo que ata cada ruta con su tipo sin mandar la ruta de
		// vuelta.
		const posicion = cola.length;
		cola.push(ruta);

		return tanda.then((tipos) => tipos[posicion] ?? SIN_RESOLVER);
	}

	return {
		tipoDelArchivo(ruta: string): Promise<string> {
			const guardado = resueltos.get(ruta);
			if (guardado) return guardado;

			const pedido: Promise<string> = encolar(ruta).catch((error) => {
				if (resueltos.get(ruta) === pedido) resueltos.delete(ruta);
				throw error;
			});

			resueltos.set(ruta, pedido);
			return pedido;
		},

		get guardados(): number {
			return resueltos.size;
		},
	};
}

/** Las cadenas ya pedidas al backend, por tipo. */
const cadenas = new Map<string, Promise<string[]>>();

/**
 * La cadena de nombres de un tipo, preguntándola una sola vez.
 *
 * Se guarda aparte de lo elegido porque **no depende del tema**: la arma GIO a
 * partir del tipo de contenido. Cuál de esos nombres se usa sí depende, y eso es
 * lo único que se tira al cambiarlo.
 */
function cadenaDelTipo(tipo: string): Promise<string[]> {
	const guardada = cadenas.get(tipo);
	if (guardada) return guardada;

	const pedido: Promise<string[]> = invoke<string[]>('iconos_de_tipo', { tipo })
		.then((nombres) => (nombres.length > 0 ? nombres : [GENERICO]))
		.catch((error) => {
			if (cadenas.get(tipo) === pedido) cadenas.delete(tipo);
			throw error;
		});

	cadenas.set(tipo, pedido);
	return pedido;
}

const pregunton = crearPreguntonDeTipos((rutas) =>
	invoke<(string | null)[]>('mirando_adentro', { rutas })
);

const resolutor = crearResolutorDeIconos({
	tipoDelArchivo: pregunton.tipoDelArchivo,
	cadenaDelTipo,
	tieneIcono: hasIcon,
});

/** El nombre del icono de una entrada. */
export function nombreDeIcono(entry: DirEntry): Promise<string> {
	return resolutor.nombreDeIcono(entry);
}

/** Tira lo resuelto. Va cuando cambia el tema de iconos. */
export function olvidarNombres(): void {
	resolutor.olvidar();
}
