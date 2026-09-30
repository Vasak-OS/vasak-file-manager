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
 * obligatoria (`^8`) en vez de traerla adentro, y la importa en la primera línea
 * de su `dist`. Con `pinia` 4 ya adentro, `@vue/devtools-api` está declarada en
 * el manifiesto justamente por eso; el guardia se queda porque la forma del
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

const root = fileURLToPath(new URL('..', import.meta.url));

interface Manifest {
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/** Un manifiesto, o `null` si no está instalado. */
async function read(path: string): Promise<Manifest | null> {
	const file = Bun.file(path);
	return (await file.exists()) ? ((await file.json()) as Manifest) : null;
}

interface Peer {
	/** Quién la pide. */
	pkg: string;
	/** Qué pide. */
	peer: string;
	/** En qué rango. */
	range: string;
	/** Qué versión hay instalada, si hay alguna. */
	installed: string | null;
	/** Con qué rango la declara este repositorio, si la declara. */
	declared: string | null;
}

/**
 * Las pares **obligatorias** de las dependencias directas del proyecto.
 *
 * Sólo las directas: las de más adentro las resuelve el instalador anidándolas
 * si hace falta, y no son de este manifiesto. Las marcadas como opcionales
 * quedan afuera a propósito —`typescript` en `pinia`, sin ir más lejos—.
 */
async function requiredPeers(base: string): Promise<Peer[]> {
	const manifest = await read(`${base}package.json`);
	if (!manifest) return [];

	const declared = { ...manifest.devDependencies, ...manifest.dependencies };
	const peers: Peer[] = [];

	for (const pkg of Object.keys(manifest.dependencies ?? {}).sort()) {
		const own = await read(`${base}node_modules/${pkg}/package.json`);
		if (!own) continue;

		const meta = own.peerDependenciesMeta ?? {};
		for (const [peer, range] of Object.entries(own.peerDependencies ?? {})) {
			if (meta[peer]?.optional) continue;

			peers.push({
				pkg,
				peer,
				range,
				installed: (await read(`${base}node_modules/${peer}/package.json`))?.version ?? null,
				declared: declared[peer] ?? null,
			});
		}
	}

	return peers;
}

/** Las que este repositorio no declara. */
function undeclared(peers: Peer[]): Peer[] {
	return peers.filter((peer) => peer.declared === null);
}

/** Las que están instaladas en una versión que quien las pide no acepta. */
function outOfRange(peers: Peer[]): Peer[] {
	return peers.filter(
		(peer) => peer.installed === null || !Bun.semver.satisfies(peer.installed, peer.range)
	);
}

const peers = await requiredPeers(root);

describe('las dependencias pares obligatorias', () => {
	test('y las dos pruebas que siguen miran un árbol de verdad', () => {
		// Las dos recorren `peers`: con la lista vacía —un `node_modules` sin
		// instalar, una raíz mal armada— pasan solas sin haber mirado nada.
		expect(peers.length).toBeGreaterThan(3);
		// Y pares nombradas, del ecosistema y de afuera: si el recorrido dejara
		// de entrar a `node_modules` —o de leer los manifiestos de adentro— la
		// lista quedaría corta sin quedar vacía.
		expect(peers).toContainEqual(
			expect.objectContaining({
				pkg: '@vasakgroup/vue-libvasak',
				peer: '@vasakgroup/plugin-config-manager',
			})
		);
		expect(peers).toContainEqual(expect.objectContaining({ pkg: 'pinia', peer: 'vue' }));
		expect(peers).toContainEqual(
			expect.objectContaining({ pkg: 'pinia', peer: '@vue/devtools-api' })
		);
	});

	test('están todas declaradas en el manifiesto', () => {
		expect(undeclared(peers)).toEqual([]);
	});

	test('y la versión instalada entra en el rango que piden', () => {
		expect(outOfRange(peers)).toEqual([]);
	});

	test('y se comprueba: las dos pruebas de arriba fallan sobre un árbol roto', async () => {
		// El control positivo, sobre un árbol de mentira armado aparte. Sin esto,
		// un `requiredPeers` que devuelva siempre `[]` —o que se coma las
		// obligatorias junto con las opcionales— deja las dos pruebas de arriba
		// en verde para siempre. La de rango no se puede sabotear de otra forma:
		// haría falta instalar a propósito una versión que nadie acepta.
		const fake = `${tmpdir()}/vsk-pares-${Bun.randomUUIDv7()}/`;
		try {
			await Bun.write(
				`${fake}package.json`,
				JSON.stringify({
					dependencies: { pide: '^1.0.0', 'pide-viejo': '^1.0.0', 'pide-opcional': '^1.0.0' },
					// Declarada, así que sale por rango y no por falta de declaración:
					// son dos fallos distintos y cada prueba mira el suyo.
					devDependencies: { presente: '^3.0.0' },
				})
			);
			await Bun.write(
				`${fake}node_modules/pide/package.json`,
				JSON.stringify({
					version: '1.0.0',
					peerDependencies: { ausente: '^2.0.0', presente: '^3.0.0' },
				})
			);
			await Bun.write(
				`${fake}node_modules/pide-viejo/package.json`,
				JSON.stringify({ version: '1.0.0', peerDependencies: { presente: '^4.0.0' } })
			);
			await Bun.write(
				`${fake}node_modules/pide-opcional/package.json`,
				JSON.stringify({
					version: '1.0.0',
					peerDependencies: { tampoco: '^1.0.0' },
					peerDependenciesMeta: { tampoco: { optional: true } },
				})
			);
			await Bun.write(
				`${fake}node_modules/presente/package.json`,
				JSON.stringify({ version: '3.1.0' })
			);

			const found = await requiredPeers(fake);

			// La opcional no está, y las obligatorias sí —incluida la que dos
			// paquetes piden en rangos que no se cruzan—.
			expect(found.map((peer) => peer.peer).sort()).toEqual(['ausente', 'presente', 'presente']);
			expect(found.find((peer) => peer.peer === 'ausente')).toEqual({
				pkg: 'pide',
				peer: 'ausente',
				range: '^2.0.0',
				installed: null,
				declared: null,
			});

			// Y los dos filtros marcan lo suyo: la que falta, sin declarar; la
			// que está instalada en 3.1.0 y `pide-viejo` quiere en `^4.0.0`,
			// fuera de rango. La 3.1.0 que sí sirve para `pide` no aparece en
			// ninguno de los dos.
			expect(undeclared(found).map((peer) => peer.peer)).toEqual(['ausente']);
			expect(outOfRange(found).map((peer) => `${peer.pkg}→${peer.peer}`)).toEqual([
				'pide→ausente',
				'pide-viejo→presente',
			]);
		} finally {
			await Bun.$`rm -rf ${fake}`.quiet();
		}
	});
});

describe('pinia 4 y el complemento de configuración', () => {
	test('el complemento la pide como par, así que usa la de la aplicación', async () => {
		// La condición de salida de la nota que había en `bibliotecasAtrasadas`:
		// hasta la 2.6 el complemento traía `pinia` como dependencia normal, y
		// con la aplicación en 4 se anidaba una 3 abajo suyo. Si una versión
		// futura vuelve a declararla así, esto lo dice antes que la pantalla.
		const plugin = await read(`${root}node_modules/@vasakgroup/plugin-config-manager/package.json`);

		expect(plugin?.dependencies?.pinia).toBeUndefined();
		expect(plugin?.peerDependencies?.pinia).toBeDefined();
	});

	test('y la pinia instalada es la 4, dentro del rango que el complemento acepta', async () => {
		const pinia = await read(`${root}node_modules/pinia/package.json`);
		const plugin = await read(`${root}node_modules/@vasakgroup/plugin-config-manager/package.json`);
		const version = pinia?.version ?? '';

		expect(Bun.semver.satisfies(version, '^4.0.0')).toBe(true);
		expect(Bun.semver.satisfies(version, plugin?.peerDependencies?.pinia ?? '')).toBe(true);
	});

	test('y la nota de pinia ya no está en bibliotecasAtrasadas', async () => {
		// Una nota que sobrevive a su condición de salida es peor que ninguna:
		// dice que algo está frenado a propósito cuando ya no lo está.
		const manifest = (await Bun.file(`${root}package.json`).json()) as {
			vasak?: { bibliotecasAtrasadas?: Record<string, string> };
		};
		const notes = Object.keys(manifest.vasak?.bibliotecasAtrasadas ?? {});

		expect(notes).not.toContain('pinia');
		expect(notes).not.toContain('@vasakgroup/plugin-config-manager');
	});
});
