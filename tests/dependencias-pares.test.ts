/**
 * Que toda dependencia *par* obligatoria esté declarada en el manifiesto.
 *
 * Una dependencia par —`peerDependencies`— es lo que un paquete usa pero **no
 * trae**: espera encontrarlo instalado al lado. Cuando está marcada como
 * opcional, su ausencia es un caso previsto; cuando no, el paquete se rompe sin
 * ella. `bun install` avisa de una par sin resolver con una línea de aviso, y un
 * aviso no corta nada: la instalación termina bien y el fallo aparece después,
 * al importar.
 *
 * Esto se escribió probando `pinia` 4, que mueve `@vue/devtools-api` a par
 * obligatoria en vez de traerla adentro. Ese salto quedó afuera por otro motivo
 * —ver `una-sola-copia.test.ts`—, pero el guardia se queda, porque la forma del
 * problema no es de `pinia`: es de cualquier paquete que empiece a pedir algo al
 * lado.
 *
 * El detalle que lo hace peligroso es que **ningún archivo de esta aplicación
 * importa una par**: queda en el manifiesto sin que nada en `src/` la nombre,
 * que es exactamente la forma de una dependencia de más. El día que alguien
 * barra las que no se usan —cosa que en este taller ya se hizo, y con razón— se
 * la lleva puesta, y lo que se rompe no es el chequeo de tipos ni las pruebas
 * —el empaquetado de producción descarta el código de desarrollo—: es el
 * servidor, al resolver el import que el paquete hace por dentro. Se comprobó:
 * sin ella, `bun` corta con «Cannot find module '@vue/devtools-api'».
 *
 * Por eso se mira el árbol instalado y no una lista escrita a mano: la par la
 * declara el paquete de arriba, así que aparece sola cuando una versión nueva la
 * agrega. Es la otra mitad del guardia de versiones del CI, que comprueba que no
 * nos quedemos atrás pero no que lo que se instala esté completo.
 */

import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));

interface Manifiesto {
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/** Un manifiesto, o `null` si no está instalado. */
async function leer(ruta: string): Promise<Manifiesto | null> {
	const archivo = Bun.file(ruta);
	return (await archivo.exists()) ? ((await archivo.json()) as Manifiesto) : null;
}

interface Par {
	/** Quién la pide. */
	paquete: string;
	/** Qué pide. */
	peer: string;
	/** En qué rango. */
	rango: string;
	/** Qué versión hay instalada, si hay alguna. */
	instalado: string | null;
	/** Con qué rango la declara este repositorio, si la declara. */
	declarado: string | null;
}

/**
 * Las pares **obligatorias** de las dependencias directas del proyecto.
 *
 * Sólo las directas: las de más adentro las resuelve el instalador anidándolas
 * si hace falta, y no son de este manifiesto. Las marcadas como opcionales
 * quedan afuera a propósito —`typescript` en `pinia`, sin ir más lejos—.
 */
async function paresObligatorias(base: string): Promise<Par[]> {
	const manifiesto = await leer(`${base}package.json`);
	if (!manifiesto) return [];

	const declaradas = { ...manifiesto.devDependencies, ...manifiesto.dependencies };
	const pares: Par[] = [];

	for (const paquete of Object.keys(manifiesto.dependencies ?? {}).sort()) {
		const suyo = await leer(`${base}node_modules/${paquete}/package.json`);
		if (!suyo) continue;

		const meta = suyo.peerDependenciesMeta ?? {};
		for (const [peer, rango] of Object.entries(suyo.peerDependencies ?? {})) {
			if (meta[peer]?.optional) continue;

			pares.push({
				paquete,
				peer,
				rango,
				instalado: (await leer(`${base}node_modules/${peer}/package.json`))?.version ?? null,
				declarado: declaradas[peer] ?? null,
			});
		}
	}

	return pares;
}

/** Las que este repositorio no declara. */
function sinDeclarar(pares: Par[]): Par[] {
	return pares.filter((par) => par.declarado === null);
}

/** Las que están instaladas en una versión que quien las pide no acepta. */
function fueraDeRango(pares: Par[]): Par[] {
	return pares.filter(
		(par) => par.instalado === null || !Bun.semver.satisfies(par.instalado, par.rango)
	);
}

const pares = await paresObligatorias(raiz);

describe('las dependencias pares obligatorias', () => {
	test('y las dos pruebas que siguen miran un árbol de verdad', () => {
		// Las dos recorren `pares`: con la lista vacía —un `node_modules` sin
		// instalar, una raíz mal armada— pasan solas sin haber mirado nada.
		expect(pares.length).toBeGreaterThan(3);
		// Y dos pares nombradas, una del ecosistema y una de afuera: si el
		// recorrido dejara de entrar a `node_modules` —o de leer los manifiestos
		// de adentro— la lista quedaría corta sin quedar vacía.
		expect(pares).toContainEqual(
			expect.objectContaining({
				paquete: '@vasakgroup/vue-libvasak',
				peer: '@vasakgroup/plugin-config-manager',
			})
		);
		expect(pares).toContainEqual(expect.objectContaining({ paquete: 'pinia', peer: 'vue' }));
	});

	test('están todas declaradas en el manifiesto', () => {
		expect(sinDeclarar(pares)).toEqual([]);
	});

	test('y la versión instalada entra en el rango que piden', () => {
		expect(fueraDeRango(pares)).toEqual([]);
	});

	test('y se comprueba: las dos pruebas de arriba fallan sobre un árbol roto', async () => {
		// El control positivo, sobre un árbol de mentira armado aparte. Sin esto,
		// un `paresObligatorias` que devuelva siempre `[]` —o que se coma las
		// obligatorias junto con las opcionales— deja las dos pruebas de arriba
		// en verde para siempre. La de rango no se puede sabotear de otra forma:
		// haría falta instalar a propósito una versión que nadie acepta.
		const falso = `${tmpdir()}/vsk-pares-${Bun.randomUUIDv7()}/`;
		try {
			await Bun.write(
				`${falso}package.json`,
				JSON.stringify({
					dependencies: { pide: '^1.0.0', 'pide-viejo': '^1.0.0', 'pide-opcional': '^1.0.0' },
					// Declarada, así que sale por rango y no por falta de declaración:
					// son dos fallos distintos y cada prueba mira el suyo.
					devDependencies: { presente: '^3.0.0' },
				})
			);
			await Bun.write(
				`${falso}node_modules/pide/package.json`,
				JSON.stringify({
					version: '1.0.0',
					peerDependencies: { ausente: '^2.0.0', presente: '^3.0.0' },
				})
			);
			await Bun.write(
				`${falso}node_modules/pide-viejo/package.json`,
				JSON.stringify({ version: '1.0.0', peerDependencies: { presente: '^4.0.0' } })
			);
			await Bun.write(
				`${falso}node_modules/pide-opcional/package.json`,
				JSON.stringify({
					version: '1.0.0',
					peerDependencies: { tampoco: '^1.0.0' },
					peerDependenciesMeta: { tampoco: { optional: true } },
				})
			);
			await Bun.write(
				`${falso}node_modules/presente/package.json`,
				JSON.stringify({ version: '3.1.0' })
			);

			const hallados = await paresObligatorias(falso);

			// La opcional no está, y las obligatorias sí —incluida la que dos
			// paquetes piden en rangos que no se cruzan—.
			expect(hallados.map((par) => par.peer).sort()).toEqual(['ausente', 'presente', 'presente']);
			expect(hallados.find((par) => par.peer === 'ausente')).toEqual({
				paquete: 'pide',
				peer: 'ausente',
				rango: '^2.0.0',
				instalado: null,
				declarado: null,
			});

			// Y los dos filtros marcan lo suyo: la que falta, sin declarar; la
			// que está instalada en 3.1.0 y `pide-viejo` quiere en `^4.0.0`,
			// fuera de rango. La 3.1.0 que sí sirve para `pide` no aparece en
			// ninguno de los dos.
			expect(sinDeclarar(hallados).map((par) => par.peer)).toEqual(['ausente']);
			expect(fueraDeRango(hallados).map((par) => `${par.paquete}→${par.peer}`)).toEqual([
				'pide→ausente',
				'pide-viejo→presente',
			]);
		} finally {
			await Bun.$`rm -rf ${falso}`.quiet();
		}
	});
});
