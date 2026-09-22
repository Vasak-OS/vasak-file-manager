/**
 * El gestor ya no sabe resolver iconos.
 *
 * Tenía la copia más grande del taller del composable del icono: noventa
 * llamadas en veintitrés archivos, más que las ocho aplicaciones migradas antes
 * juntas. La copia sabía dos cosas —descartar la respuesta que llega tarde, y
 * vaciar la memoria en el mismo lugar que dispara el redibujado— y le faltaban
 * tres que la librería tiene: memorizar por nombre entre componentes, compartir
 * el pedido en vuelo, y recargar antes lo que está en pantalla.
 *
 * Lo que se vigila acá es que no vuelva. Nada de esto falla ni avisa: una copia
 * nueva compila, pasa las pruebas y se ve igual — y se separa, que es
 * exactamente como el taller terminó con nueve versiones distintas de la misma
 * idea (Vasak-OS/vue-libvasak#54).
 */

import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';

const raiz = new URL('../src/', import.meta.url).pathname;

const fuentes = await Promise.all(
	[...new Glob('**/*.{vue,ts}').scanSync(raiz)]
		.filter((ruta) => !ruta.endsWith('.test.ts'))
		.map(async (ruta) => ({ ruta, texto: await Bun.file(raiz + ruta).text() }))
);

function conteniendo(patron: RegExp): string[] {
	return fuentes.filter(({ texto }) => patron.test(texto)).map(({ ruta }) => ruta);
}

/**
 * Quién **importa** el resolutor, no quién lo nombra.
 *
 * Buscar la palabra suelta da rojo con el código bien: `iconos-de-entrada.ts`
 * explica en un comentario por qué `getIconSource` no falla cuando el icono no
 * está, y ese comentario es justamente lo que no hay que borrar. El import es
 * lo que no se puede escribir sin ir en serio.
 */
const IMPORTA_EL_RESOLUTOR =
	/import\s*\{[^}]*\bget(?:Icon|Symbol)Source\b[^}]*\}\s*from\s*'@vasakgroup\/plugin-vicons'/;

/**
 * Quién puede seguir pidiendo una fuente de icono, y por qué.
 *
 * El menú contextual recibe **una función** que resuelve nombres, no un icono:
 * los dibuja su propio proceso, fuera de esta ventana, así que no hay
 * componente al que pasarle un nombre.
 */
const EXCEPCIONES = new Set(['main.ts']);

describe('nadie resuelve iconos a mano', () => {
	test('sólo el que no puede hacerlo de otra forma', () => {
		const aMano = conteniendo(IMPORTA_EL_RESOLUTOR).filter((ruta) => !EXCEPCIONES.has(ruta));

		expect(aMano).toEqual([]);
	});

	test('y la excepción sigue haciendo falta', () => {
		// Una excepción que ya no se usa es una puerta abierta: el día que
		// alguien vuelva a resolver a mano en ese archivo, nadie se entera.
		const sobrantes = [...EXCEPCIONES].filter((ruta) => !IMPORTA_EL_RESOLUTOR.test(leer(ruta)));

		expect(sobrantes).toEqual([]);
	});

	test('no existe un composable propio del icono', () => {
		expect(fuentes.map(({ ruta }) => ruta).filter((r) => /useReactiveIcon/i.test(r))).toEqual([]);
		expect(conteniendo(/\buseReactiveIcon\b/)).toEqual([]);
	});

	test('nadie se suscribe al cambio de tema por su cuenta', () => {
		// Quien escuche `vicons:theme-changed` para volver a pedir un icono está
		// rehaciendo lo que la librería ya hace, y encima sin el planificador:
		// al cambiar de tema recargaría los iconos que no se ven antes que los
		// que sí. Si hace falta enterarse —acá hace falta, porque el **nombre**
		// depende del tema— el enganche es `usarLaVersionDelTema`.
		expect(conteniendo(/vicons:theme-changed/)).toEqual([]);
	});

	test('y nadie arma su propio planificador de recarga', () => {
		expect(conteniendo(/IntersectionObserver/)).toEqual([]);
	});
});

const leer = (ruta: string) => fuentes.find((f) => f.ruta === ruta)?.texto ?? '';

describe('el nombre del icono sí lo sabe el gestor', () => {
	test('y es lo único que sigue siendo suyo', () => {
		// No es una copia: es lo que la librería no puede saber. La cadena de
		// nombres de un tipo la arma GIO, y cuál de ellos se usa depende de qué
		// tenga el tema instalado.
		expect(leer('utils/iconos-de-entrada.ts')).toContain('tieneIcono: hasIcon');
		expect(leer('components/icons/EntryIconComponent.vue')).toContain('usarLaVersionDelTema');
	});
});
