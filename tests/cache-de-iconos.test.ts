import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crearCacheDeIconos } from '../src/utils/cache-de-iconos';

/**
 * Un icono se pide una vez, no una vez por archivo.
 *
 * Cada fila de la lista pedía el suyo con un `invoke` al backend, y el icono
 * vuelve en base64. Pero los nombres posibles son ocho, así que abrir
 * `/usr/bin` —3.585 entradas en una máquina común— eran 3.585 viajes por el
 * puente para pedir cuatro iconos.
 */

function contador() {
	let llamadas = 0;
	const pedir = async (nombre: string) => {
		llamadas++;
		return `data:imagen-de-${nombre}`;
	};
	return {
		pedir,
		get llamadas() {
			return llamadas;
		},
	};
}

describe('la caché de iconos', () => {
	test('el mismo nombre se pide una sola vez', async () => {
		const backend = contador();
		const cache = crearCacheDeIconos(backend.pedir);

		expect(await cache.pedir('folder')).toBe('data:imagen-de-folder');
		expect(await cache.pedir('folder')).toBe('data:imagen-de-folder');

		expect(backend.llamadas).toBe(1);
	});

	/**
	 * Ésta es la razón de guardar la promesa y no el valor. Las filas se montan
	 * todas en el mismo tic: cuando la segunda pregunta, la primera todavía no
	 * contestó. Una caché de valores no tendría nada guardado y dejaría pasar
	 * las 3.585 igual.
	 */
	test('una ráfaga simultánea también se colapsa', async () => {
		const backend = contador();
		const cache = crearCacheDeIconos(backend.pedir);

		const respuestas = await Promise.all(Array.from({ length: 3585 }, () => cache.pedir('folder')));

		expect(backend.llamadas).toBe(1);
		expect(new Set(respuestas).size).toBe(1);
	});

	test('un directorio entero cuesta tantos pedidos como iconos distintos', async () => {
		const backend = contador();
		const cache = crearCacheDeIconos(backend.pedir);
		const nombres = ['folder', 'text-x-generic', 'image-x-generic', 'application-rtf'];

		await Promise.all(
			Array.from({ length: 3585 }, (_, i) => cache.pedir(nombres[i % nombres.length]))
		);

		expect(backend.llamadas).toBe(nombres.length);
		expect(cache.guardados).toBe(nombres.length);
	});

	test('nombres distintos no se pisan', async () => {
		const backend = contador();
		const cache = crearCacheDeIconos(backend.pedir);

		expect(await cache.pedir('folder')).toBe('data:imagen-de-folder');
		expect(await cache.pedir('text-x-generic')).toBe('data:imagen-de-text-x-generic');
		expect(backend.llamadas).toBe(2);
	});

	test('lo que falló se olvida, y el siguiente vuelve a intentar', async () => {
		let llamadas = 0;
		const cache = crearCacheDeIconos(async (nombre) => {
			llamadas++;
			if (llamadas === 1) throw new Error('el backend no contestó');
			return `data:imagen-de-${nombre}`;
		});

		// Sin olvidar el error, quedaría pegado hasta que cambie el tema: el
		// icono de ese tipo de archivo no volvería nunca en toda la sesión.
		await expect(cache.pedir('folder')).rejects.toThrow('el backend no contestó');
		expect(cache.guardados).toBe(0);

		expect(await cache.pedir('folder')).toBe('data:imagen-de-folder');
		expect(llamadas).toBe(2);
	});

	test('olvidar hace que se vuelvan a pedir', async () => {
		const backend = contador();
		const cache = crearCacheDeIconos(backend.pedir);

		await cache.pedir('folder');
		cache.olvidar();
		await cache.pedir('folder');

		expect(backend.llamadas).toBe(2);
		expect(cache.guardados).toBe(1);
	});
});

describe('el cambio de tema', () => {
	const COMPOSABLE = readFileSync(
		join(import.meta.dir, '..', 'src', 'composables', 'useReactiveIcon.ts'),
		'utf8'
	);

	test('vacía la caché antes de pedir de nuevo', () => {
		// Si se vaciara después —o desde otro oyente, donde el orden no está
		// garantizado—, el redibujado tomaría de la caché los iconos del tema
		// viejo y el cambio no se vería hasta el siguiente directorio.
		const oyente = COMPOSABLE.slice(COMPOSABLE.indexOf("listen('vicons:theme-changed'"));

		expect(oyente.indexOf('olvidarIconos()')).toBeGreaterThan(-1);
		expect(oyente.indexOf('olvidarIconos()')).toBeLessThan(oyente.indexOf('version.value++'));
	});
});
