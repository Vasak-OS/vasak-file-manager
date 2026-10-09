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
 * No es hipotético. La primera vez que se probó `pinia` 4 acá, el instalador
 * dejó la 4 en la raíz y anidó una 3 abajo de
 * `@vasakgroup/plugin-config-manager`, que entonces la declaraba como
 * dependencia **normal** en vez de par —o sea, se traía la suya en lugar de usar
 * la de quien lo monta—. La aplicación importa `useConfigStore` de ese
 * complemento en `App.vue`, así que la pantalla habría arrancado con:
 *
 *     [🍍]: "getActivePinia()" was called but there was no active Pinia.
 *
 * Nada de lo que había lo veía: el chequeo de tipos pasaba, las pruebas pasaban
 * y el empaquetado de producción terminaba bien. Por eso la primera prueba de
 * acá es de comportamiento y no de forma —monta la tienda del complemento con la
 * `pinia` de la aplicación— y la segunda explica por qué falla cuando falla.
 *
 * El complemento la pide como par desde la 2.7, y la 2.9.0 acepta las dos
 * mayores (`^3.0.4 || ^4.0.0`); con eso la aplicación pasó a `pinia` 4. El guardia se
 * queda: es el equivalente de `cargo tree --duplicates` del lado de JavaScript,
 * y la próxima biblioteca que se traiga su propia copia de algo va a hacer lo
 * mismo sin avisar.
 */

import { describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { useConfigStore } from '@vasakgroup/plugin-config-manager';
import { createPinia, setActivePinia } from 'pinia';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * Cada paquete del árbol y en qué rutas aparece.
 *
 * Recorre también los `node_modules` anidados, que es donde el instalador deja
 * la segunda copia: mirar sólo el de la raíz no la vería, que es justamente el
 * caso que este archivo vigila.
 */
async function copiesInTree(base: string, inside = ''): Promise<Map<string, string[]>> {
	const copies = new Map<string, string[]>();
	const folder = `${base}${inside}node_modules`;

	let entries: string[];
	try {
		entries = await readdir(folder);
	} catch {
		return copies;
	}

	// Un paquete con ámbito —`@vasakgroup/algo`— está un nivel más adentro.
	const packages = (
		await Promise.all(
			entries
				.filter((entry) => !entry.startsWith('.'))
				.map(async (entry) =>
					entry.startsWith('@')
						? (await readdir(`${folder}/${entry}`)).map((child) => `${entry}/${child}`)
						: [entry]
				)
		)
	).flat();

	// Ordenados: `readdir` devuelve en el orden del sistema de archivos, que no
	// es el mismo en todas partes, y las rutas se comparan tal cual.
	for (const pkg of packages.sort()) {
		const path = `${inside}node_modules/${pkg}`;
		copies.set(pkg, [...(copies.get(pkg) ?? []), path]);

		for (const [name, paths] of await copiesInTree(base, `${path}/`)) {
			copies.set(name, [...(copies.get(name) ?? []), ...paths]);
		}
	}

	return copies;
}

const manifest = (await Bun.file(`${root}package.json`).json()) as {
	dependencies?: Record<string, string>;
};
const direct = Object.keys(manifest.dependencies ?? {});
const copies = await copiesInTree(root);

/** Las directas que aparecen más de una vez, con sus rutas. */
function duplicated(names: string[], tree: Map<string, string[]>): [string, string[]][] {
	return names
		.map((name): [string, string[]] => [name, tree.get(name) ?? []])
		.filter(([, paths]) => paths.length > 1);
}

describe('las dependencias directas', () => {
	test('comparten su copia con los complementos que las usan', () => {
		// La prueba de comportamiento, y la única que habría visto el problema:
		// la tienda del complemento de configuración tiene que arrancar con la
		// `pinia` que activa la aplicación. Con dos copias esto tira
		// «getActivePinia() was called but there was no active Pinia».
		setActivePinia(createPinia());

		const store = useConfigStore();

		// Que devuelva una tienda de verdad y no cualquier objeto: `$id` es lo
		// que `defineStore` le pone, y es el nombre con el que se registró.
		expect(store.$id).toBe('config');
	});

	test('y el recorrido del árbol mira paquetes de verdad', () => {
		// Sin esto, un recorrido que devuelva un mapa vacío deja la prueba de
		// abajo en verde para siempre.
		expect(direct.length).toBeGreaterThan(5);
		expect(copies.size).toBeGreaterThan(direct.length);
		// Con ámbito y sin ámbito, que se leen por caminos distintos.
		expect(copies.get('pinia')).toEqual(['node_modules/pinia']);
		expect(copies.get('@vasakgroup/vue-libvasak')?.length).toBe(1);
	});

	test('no tienen una segunda copia anidada', () => {
		expect(duplicated(direct, copies)).toEqual([]);
	});

	test('y se comprueba: una copia anidada aparece, y una de otro paquete no', async () => {
		// El control positivo. La copia anidada de algo que **no** es dependencia
		// directa —lo que el instalador hace todo el tiempo, y sin consecuencias—
		// no tiene que aparecer: un guardia que marque eso da falsos avisos en
		// cada instalación y termina apagado.
		const fake = `${tmpdir()}/vsk-copias-${Bun.randomUUIDv7()}/`;
		try {
			await Bun.write(`${fake}node_modules/pinia/package.json`, '{"version":"4.0.3"}');
			await Bun.write(
				`${fake}node_modules/@ambito/complemento/node_modules/pinia/package.json`,
				'{"version":"3.0.4"}'
			);
			await Bun.write(`${fake}node_modules/@ambito/complemento/package.json`, '{}');
			await Bun.write(`${fake}node_modules/otro/node_modules/interna/package.json`, '{}');
			await Bun.write(`${fake}node_modules/otro/package.json`, '{}');

			const tree = await copiesInTree(fake);

			expect(tree.get('pinia')).toEqual([
				'node_modules/@ambito/complemento/node_modules/pinia',
				'node_modules/pinia',
			]);
			expect(duplicated(['pinia', 'otro', '@ambito/complemento'], tree)).toEqual([
				['pinia', ['node_modules/@ambito/complemento/node_modules/pinia', 'node_modules/pinia']],
			]);
			// `interna` está una sola vez y además no es directa: por los dos
			// motivos queda afuera.
			expect(tree.get('interna')?.length).toBe(1);
		} finally {
			await Bun.$`rm -rf ${fake}`.quiet();
		}
	});
});
