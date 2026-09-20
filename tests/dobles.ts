/**
 * Los dobles de todo lo que sólo existe adentro de la ventana de Tauri.
 *
 * Una prueba montada corre en `happy-dom`, no en un WebView: no hay backend que
 * atienda un `invoke`, no hay quien emita un evento y no hay traducciones
 * cargadas. Sin estos dobles, importar cualquier componente falla en la primera
 * línea.
 *
 * Los dobles no son mudos: guardan lo que se les pidió y dejan contestar, que
 * es lo que permite comprobar comportamiento y no sólo forma.
 *
 * Se registran como módulos desde `tests/preparar.ts`, que corre antes que
 * cualquier prueba. El estado vive acá, así que una prueba que importe este
 * archivo ve lo mismo que vio el componente.
 */

/** Una llamada al backend, tal como la hizo la ventana. */
export interface Invocacion {
	comando: string;
	argumentos: Record<string, unknown>;
}

/** Todo lo que se le pidió al backend, en orden. */
export const invocaciones: Invocacion[] = [];

type Respondedor = (argumentos: Record<string, unknown>) => unknown;

const respuestas = new Map<string, Respondedor>();
const oyentes = new Map<string, Set<(evento: { payload: unknown }) => unknown>>();

/** Qué contesta el backend a un comando. */
export function responder(comando: string, respuesta: Respondedor | unknown) {
	respuestas.set(
		comando,
		typeof respuesta === 'function' ? (respuesta as Respondedor) : () => respuesta
	);
}

/** Las veces que se pidió un comando. */
export function pedidos(comando: string) {
	return invocaciones.filter((una) => una.comando === comando);
}

export async function invoke(comando: string, argumentos: Record<string, unknown> = {}) {
	invocaciones.push({ comando, argumentos });
	const respondedor = respuestas.get(comando);
	// Un comando sin respuesta preparada devuelve nada en vez de romper: son los
	// de alrededor que la prueba no mira y que obligarían a preparar media API
	// para comprobar una cosa.
	return respondedor ? await respondedor(argumentos) : undefined;
}

/**
 * La ruta de un archivo local como la sirve el protocolo de Tauri.
 *
 * El prefijo no es el real —lo arma Tauri con el identificador de la ventana—,
 * pero lo que las pruebas comprueban es que la ruta *pase por acá*: cargarla
 * cruda la bloquea la política de contenido.
 */
export function convertFileSrc(ruta: string) {
	return `vasak://localhost/${encodeURIComponent(ruta)}`;
}

export async function listen(nombre: string, manejador: (evento: { payload: unknown }) => unknown) {
	const suyos = oyentes.get(nombre) ?? new Set();
	suyos.add(manejador);
	oyentes.set(nombre, suyos);
	return () => {
		suyos.delete(manejador);
	};
}

/** Emite un evento del backend y espera a que lo atiendan. */
export async function emitir(nombre: string, payload: unknown) {
	for (const manejador of [...(oyentes.get(nombre) ?? [])]) {
		await manejador({ payload });
	}
}

/** El `t()` devuelve la clave: una prueba que mire el texto mira la clave. */
export function useI18n() {
	return {
		t: (clave: string) => clave,
		locale: { value: 'es' },
		setLocale: async () => {},
		availableLocales: { value: ['es'] },
		isLoaded: { value: true },
		reload: async () => {},
	};
}

const temaDeIconos = new Map<string, string | (() => Promise<string>)>();

/** Pone un nombre en el tema de íconos. */
export function ponerEnElTema(nombre: string, fuente: string | (() => Promise<string>)) {
	temaDeIconos.set(nombre, fuente);
}

/**
 * Lo que el tema no tiene vuelve como cadena vacía, no como error.
 *
 * Es lo que hace el plugin de verdad: atrapa lo suyo, lo escribe en la consola
 * y devuelve `''`. Que el doble lanzara sería más estricto que la realidad y
 * haría fallar a componentes que no tienen por qué atrapar nada.
 */
export async function getIconSource(nombre: string) {
	pedidosDeIcono.push({ nombre, variante: 'icon' });
	const puesto = temaDeIconos.get(nombre) ?? '';
	return typeof puesto === 'function' ? await puesto() : puesto;
}

/**
 * Qué se le pidió al tema, y en qué variante.
 *
 * Las dos variantes son una cadena desde afuera, así que sin anotarlo no hay
 * forma de comprobar cuál se pidió. Importa en los botones de la ventana: en
 * color, `window-close` de los temas derivados de Breeze —los de VasakOS lo
 * son— es el círculo rojo relleno de KDE, y el simbólico una equis del mismo
 * gris que los otros dos.
 */
export const pedidosDeIcono: Array<{ nombre: string; variante: 'icon' | 'symbol' }> = [];

/** Las variantes con que se pidió un nombre, en orden. */
export function variantesPedidas(nombre: string) {
	return pedidosDeIcono.filter((pedido) => pedido.nombre === nombre).map((p) => p.variante);
}

/** Los símbolos salen del mismo tema: un doble aparte mentiría distinto. */
export async function getSymbolSource(nombre: string) {
	// Se anota **antes** de resolver y se queda con su propia entrada: el
	// `await` cede, y con dos resoluciones cruzadas la última entrada de la
	// lista puede ser de otra.
	const mio = pedidosDeIcono.length;
	const fuente = await getIconSource(nombre);
	pedidosDeIcono[mio].variante = 'symbol';
	return fuente;
}

/** Deja los dobles como recién puestos. Va en el `beforeEach` de cada prueba. */
export function olvidarTodo() {
	invocaciones.length = 0;
	respuestas.clear();
	oyentes.clear();
	temaDeIconos.clear();
	pedidosDeIcono.length = 0;
}
