/**
 * Que de cada dependencia directa haya **una sola copia** en el árbol.
 *
 * Dos copias de la misma biblioteca no dan error al instalar ni al compilar: el
 * instalador anida la segunda adentro de quien la pide y sigue. Lo que se rompe
 * es lo que guarda estado en el módulo, porque cada copia guarda el suyo. En
 * `pinia` eso es la tienda activa y el símbolo que usa para inyectarla: con dos
 * copias, `app.use(createPinia())` registra la de la aplicación y el paquete que
 * trae la otra no la encuentra nunca.
 *
 * No es hipotético. Al probar `pinia` 4 acá, el instalador dejó la 4 en la raíz
 * y anidó una 3 abajo de `@vasakgroup/plugin-config-manager`, que la declara
 * como dependencia **normal** en vez de par —o sea, se trae la suya en lugar de
 * usar la de quien lo monta—. La aplicación importa `useConfigStore` de ese
 * complemento en `App.vue`, así que la pantalla habría arrancado con:
 *
 *     [🍍]: "getActivePinia()" was called but there was no active Pinia.
 *
 * Nada de lo que había lo veía: el chequeo de tipos pasaba, las 264 pruebas
 * pasaban y el empaquetado de producción terminaba bien. Por eso la primera
 * prueba de acá es de comportamiento y no de forma —monta la tienda del
 * complemento con la `pinia` de la aplicación— y la segunda explica por qué
 * falla cuando falla.
 *
 * El arreglo de fondo va en el complemento, que tiene que pedir `pinia` como par
 * y no traérsela; mientras tanto esto es lo que avisa. Es el equivalente de
 * `cargo tree --duplicates` del lado de JavaScript.
 */

import { describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { useConfigStore } from '@vasakgroup/plugin-config-manager';
import { createPinia, setActivePinia } from 'pinia';

const raiz = fileURLToPath(new URL('..', import.meta.url));

/**
 * Cada paquete del árbol y en qué rutas aparece.
 *
 * Recorre también los `node_modules` anidados, que es donde el instalador deja
 * la segunda copia: mirar sólo el de la raíz no la vería, que es justamente el
 * caso que este archivo vigila.
 */
async function copiasEnElArbol(base: string, dentro = ''): Promise<Map<string, string[]>> {
	const copias = new Map<string, string[]>();
	const carpeta = `${base}${dentro}node_modules`;

	let entradas: string[];
	try {
		entradas = await readdir(carpeta);
	} catch {
		return copias;
	}

	// Un paquete con ámbito —`@vasakgroup/algo`— está un nivel más adentro.
	const paquetes = (
		await Promise.all(
			entradas
				.filter((entrada) => !entrada.startsWith('.'))
				.map(async (entrada) =>
					entrada.startsWith('@')
						? (await readdir(`${carpeta}/${entrada}`)).map((hijo) => `${entrada}/${hijo}`)
						: [entrada]
				)
		)
	).flat();

	// Ordenados: `readdir` devuelve en el orden del sistema de archivos, que no
	// es el mismo en todas partes, y las rutas se comparan tal cual.
	for (const paquete of paquetes.sort()) {
		const ruta = `${dentro}node_modules/${paquete}`;
		copias.set(paquete, [...(copias.get(paquete) ?? []), ruta]);

		for (const [nombre, rutas] of await copiasEnElArbol(base, `${ruta}/`)) {
			copias.set(nombre, [...(copias.get(nombre) ?? []), ...rutas]);
		}
	}

	return copias;
}

const manifiesto = (await Bun.file(`${raiz}package.json`).json()) as {
	dependencies?: Record<string, string>;
};
const directas = Object.keys(manifiesto.dependencies ?? {});
const copias = await copiasEnElArbol(raiz);

/** Las directas que aparecen más de una vez, con sus rutas. */
function duplicadas(nombres: string[], arbol: Map<string, string[]>): [string, string[]][] {
	return nombres
		.map((nombre): [string, string[]] => [nombre, arbol.get(nombre) ?? []])
		.filter(([, rutas]) => rutas.length > 1);
}

describe('las dependencias directas', () => {
	test('comparten su copia con los complementos que las usan', () => {
		// La prueba de comportamiento, y la única que habría visto el problema:
		// la tienda del complemento de configuración tiene que arrancar con la
		// `pinia` que activa la aplicación. Con dos copias esto tira
		// «getActivePinia() was called but there was no active Pinia».
		setActivePinia(createPinia());

		const tienda = useConfigStore();

		// Que devuelva una tienda de verdad y no cualquier objeto: `$id` es lo
		// que `defineStore` le pone, y es el nombre con el que se registró.
		expect(tienda.$id).toBe('config');
	});

	test('y el recorrido del árbol mira paquetes de verdad', () => {
		// Sin esto, un recorrido que devuelva un mapa vacío deja la prueba de
		// abajo en verde para siempre.
		expect(directas.length).toBeGreaterThan(5);
		expect(copias.size).toBeGreaterThan(directas.length);
		// Con ámbito y sin ámbito, que se leen por caminos distintos.
		expect(copias.get('pinia')).toEqual(['node_modules/pinia']);
		expect(copias.get('@vasakgroup/vue-libvasak')?.length).toBe(1);
	});

	test('no tienen una segunda copia anidada', () => {
		expect(duplicadas(directas, copias)).toEqual([]);
	});

	test('y se comprueba: una copia anidada aparece, y una de otro paquete no', async () => {
		// El control positivo. La copia anidada de algo que **no** es dependencia
		// directa —lo que el instalador hace todo el tiempo, y sin consecuencias—
		// no tiene que aparecer: un guardia que marque eso da falsos avisos en
		// cada instalación y termina apagado.
		const falso = `${tmpdir()}/vsk-copias-${Bun.randomUUIDv7()}/`;
		try {
			await Bun.write(`${falso}node_modules/pinia/package.json`, '{"version":"4.0.3"}');
			await Bun.write(
				`${falso}node_modules/@ambito/complemento/node_modules/pinia/package.json`,
				'{"version":"3.0.4"}'
			);
			await Bun.write(`${falso}node_modules/@ambito/complemento/package.json`, '{}');
			await Bun.write(`${falso}node_modules/otro/node_modules/interna/package.json`, '{}');
			await Bun.write(`${falso}node_modules/otro/package.json`, '{}');

			const arbol = await copiasEnElArbol(falso);

			expect(arbol.get('pinia')).toEqual([
				'node_modules/@ambito/complemento/node_modules/pinia',
				'node_modules/pinia',
			]);
			expect(duplicadas(['pinia', 'otro', '@ambito/complemento'], arbol)).toEqual([
				['pinia', ['node_modules/@ambito/complemento/node_modules/pinia', 'node_modules/pinia']],
			]);
			// `interna` está una sola vez y además no es directa: por los dos
			// motivos queda afuera.
			expect(arbol.get('interna')?.length).toBe(1);
		} finally {
			await Bun.$`rm -rf ${falso}`.quiet();
		}
	});
});
