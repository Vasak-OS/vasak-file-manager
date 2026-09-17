import { describe, expect, test } from 'bun:test';
import type { DirEntry } from '../src/types/dir-entry';
import {
	CARPETA,
	crearPreguntonDeTipos,
	crearResolutorDeIconos,
	GENERICO,
	SIN_RESOLVER,
} from '../src/utils/iconos-de-entrada';

/**
 * Qué icono le toca a cada entrada.
 *
 * Lo que se prueba acá es la **elección**: que se recorra la cadena hasta el
 * primero que el tema tenga, que se pregunte una vez por tipo y no una por
 * archivo, y que nunca se quede sin nada que dibujar. De dónde sale la cadena
 * —GIO y la base de datos del sistema— se prueba del lado del backend, en
 * `tipo_de_contenido`.
 */
const entrada = (parcial: Partial<DirEntry>): DirEntry =>
	({ name: 'x', path: '/x', is_dir: false, mime: null, ...parcial }) as DirEntry;

/** Un tema que tiene exactamente los nombres que se le digan. */
function temaCon(...disponibles: string[]) {
	const preguntas: string[] = [];

	return {
		preguntas,
		tieneIcono: async (nombre: string) => {
			preguntas.push(nombre);
			return disponibles.includes(nombre);
		},
	};
}

/** Un backend que contesta cadenas fijas y cuenta cuántas veces le preguntaron. */
function backendCon(cadenas: Record<string, string[]>, tipos: Record<string, string> = {}) {
	const pedidos: string[] = [];
	const mirados: string[] = [];

	return {
		pedidos,
		mirados,
		cadenaDelTipo: async (tipo: string) => {
			pedidos.push(tipo);
			return cadenas[tipo] ?? [GENERICO];
		},
		tipoDelArchivo: async (ruta: string) => {
			mirados.push(ruta);
			return tipos[ruta] ?? SIN_RESOLVER;
		},
	};
}

describe('crearResolutorDeIconos', () => {
	test('una carpeta no le pregunta nada a nadie', async () => {
		const backend = backendCon({});
		const tema = temaCon();
		const resolutor = crearResolutorDeIconos({ ...backend, ...tema });

		expect(await resolutor.nombreDeIcono(entrada({ is_dir: true, mime: 'lo/que/sea' }))).toBe(
			CARPETA
		);
		expect(backend.pedidos).toEqual([]);
		expect(tema.preguntas).toEqual([]);
	});

	test('gana el primero de la cadena que el tema tenga', async () => {
		const backend = backendCon({
			'text/x-python3': ['text-x-python3', 'text-x-generic', GENERICO],
		});
		const tema = temaCon('text-x-generic', GENERICO);
		const resolutor = crearResolutorDeIconos({ ...backend, ...tema });

		expect(await resolutor.nombreDeIcono(entrada({ mime: 'text/x-python3' }))).toBe(
			'text-x-generic'
		);
		// Se preguntó por el preciso, no estaba, y recién ahí por el del padre.
		expect(tema.preguntas).toEqual(['text-x-python3', 'text-x-generic']);
	});

	test('si el tema tiene el preciso no se sigue buscando', async () => {
		const backend = backendCon({
			'application/x-executable': ['application-x-executable', GENERICO],
		});
		const tema = temaCon('application-x-executable', GENERICO);
		const resolutor = crearResolutorDeIconos({ ...backend, ...tema });

		expect(await resolutor.nombreDeIcono(entrada({ mime: 'application/x-executable' }))).toBe(
			'application-x-executable'
		);
		expect(tema.preguntas).toEqual(['application-x-executable']);
	});

	test('sin ninguno de la cadena queda el genérico y no una cadena vacía', async () => {
		const backend = backendCon({ 'algo/raro': ['algo-raro'] });
		const resolutor = crearResolutorDeIconos({ ...backend, ...temaCon() });

		expect(await resolutor.nombreDeIcono(entrada({ mime: 'algo/raro' }))).toBe(GENERICO);
	});

	test('lo que el listado no resolvió se mira adentro', async () => {
		const backend = backendCon(
			{ 'application/x-executable': ['application-x-executable'] },
			{ '/usr/bin/ls': 'application/x-executable' }
		);
		const resolutor = crearResolutorDeIconos({
			...backend,
			...temaCon('application-x-executable'),
		});

		// Así llega un binario de `/usr/bin`: el listado no pudo con el nombre.
		const binario = entrada({ path: '/usr/bin/ls', mime: SIN_RESOLVER });

		expect(await resolutor.nombreDeIcono(binario)).toBe('application-x-executable');
		expect(backend.mirados).toEqual(['/usr/bin/ls']);
	});

	test('lo que el listado sí resolvió no se mira adentro', async () => {
		const backend = backendCon({ 'image/png': ['image-png'] });
		const resolutor = crearResolutorDeIconos({ ...backend, ...temaCon('image-png') });

		expect(await resolutor.nombreDeIcono(entrada({ mime: 'image/png' }))).toBe('image-png');
		expect(backend.mirados).toEqual([]);
	});

	test('una entrada sin tipo ninguno resuelve por el mismo camino', async () => {
		const backend = backendCon({ [SIN_RESOLVER]: ['application-octet-stream', GENERICO] });
		const resolutor = crearResolutorDeIconos({
			...backend,
			...temaCon('application-octet-stream'),
		});

		expect(await resolutor.nombreDeIcono(entrada({ mime: null }))).toBe('application-octet-stream');
	});

	/**
	 * El número que hace que esto sirva: `/usr/bin` son 3585 archivos de una
	 * docena de tipos, y tiene que costar una docena de preguntas.
	 */
	test('se pregunta una vez por tipo, no una por archivo', async () => {
		const backend = backendCon({
			'application/x-executable': ['application-x-executable'],
			'text/x-shellscript': ['text-x-shellscript'],
		});
		const tema = temaCon('application-x-executable', 'text-x-shellscript');
		const resolutor = crearResolutorDeIconos({ ...backend, ...tema });

		const muchos = Array.from({ length: 500 }, (_, indice) =>
			entrada({
				path: `/usr/bin/${indice}`,
				mime: indice % 3 === 0 ? 'text/x-shellscript' : 'application/x-executable',
			})
		);

		await Promise.all(muchos.map((una) => resolutor.nombreDeIcono(una)));

		expect(backend.pedidos.length).toBe(2);
		expect(resolutor.guardados).toBe(2);
	});

	/**
	 * Las 500 preguntan en el mismo tic, antes de que conteste la primera: una
	 * caché de valores no tendría nada guardado todavía y las dejaría pasar a
	 * todas.
	 */
	test('las que preguntan a la vez esperan la misma respuesta', async () => {
		const backend = backendCon({ 'image/png': ['image-png'] });
		const resolutor = crearResolutorDeIconos({ ...backend, ...temaCon('image-png') });

		const todas = Array.from({ length: 500 }, () =>
			resolutor.nombreDeIcono(entrada({ mime: 'image/png' }))
		);

		expect(new Set(await Promise.all(todas)).size).toBe(1);
		expect(backend.pedidos.length).toBe(1);
	});

	test('olvidar vacía lo resuelto, porque depende del tema', async () => {
		const backend = backendCon({ 'text/x-rust': ['text-x-rust', 'text-x-generic'] });
		let disponibles = ['text-x-generic'];
		const resolutor = crearResolutorDeIconos({
			...backend,
			tieneIcono: async (nombre: string) => disponibles.includes(nombre),
		});

		expect(await resolutor.nombreDeIcono(entrada({ mime: 'text/x-rust' }))).toBe('text-x-generic');

		// El tema nuevo sí tiene el preciso.
		disponibles = ['text-x-rust', 'text-x-generic'];

		expect(await resolutor.nombreDeIcono(entrada({ mime: 'text/x-rust' }))).toBe('text-x-generic');

		resolutor.olvidar();

		expect(resolutor.guardados).toBe(0);
		expect(await resolutor.nombreDeIcono(entrada({ mime: 'text/x-rust' }))).toBe('text-x-rust');
	});

	test('un fallo no queda pegado: el siguiente vuelve a intentar', async () => {
		let falla = true;
		const resolutor = crearResolutorDeIconos({
			cadenaDelTipo: async () => {
				if (falla) throw new Error('sin backend');
				return ['image-png'];
			},
			tieneIcono: async () => true,
		});

		await expect(resolutor.nombreDeIcono(entrada({ mime: 'image/png' }))).rejects.toThrow();
		expect(resolutor.guardados).toBe(0);

		falla = false;

		expect(await resolutor.nombreDeIcono(entrada({ mime: 'image/png' }))).toBe('image-png');
	});
});

describe('crearPreguntonDeTipos', () => {
	test('las del mismo tic van en un solo viaje', async () => {
		const viajes: string[][] = [];
		const pregunton = crearPreguntonDeTipos(async (rutas) => {
			viajes.push(rutas);
			return rutas.map((ruta) => `tipo/${ruta.split('/').pop()}`);
		});

		const rutas = Array.from({ length: 60 }, (_, indice) => `/usr/bin/p${indice}`);
		const tipos = await Promise.all(rutas.map((ruta) => pregunton.tipoDelArchivo(ruta)));

		expect(viajes.length).toBe(1);
		expect(viajes[0].length).toBe(60);
		// Y cada una recibió lo suyo: el orden de la respuesta es lo único que
		// ata la ruta con su tipo.
		expect(tipos[0]).toBe('tipo/p0');
		expect(tipos[59]).toBe('tipo/p59');
	});

	test('una ruta ya preguntada no vuelve a viajar', async () => {
		const viajes: string[][] = [];
		const pregunton = crearPreguntonDeTipos(async (rutas) => {
			viajes.push(rutas);
			return rutas.map(() => 'application/x-executable');
		});

		expect(await pregunton.tipoDelArchivo('/usr/bin/ls')).toBe('application/x-executable');
		expect(await pregunton.tipoDelArchivo('/usr/bin/ls')).toBe('application/x-executable');

		expect(viajes.length).toBe(1);
		expect(pregunton.guardados).toBe(1);
	});

	test('el tic siguiente abre otra tanda', async () => {
		const viajes: string[][] = [];
		const pregunton = crearPreguntonDeTipos(async (rutas) => {
			viajes.push(rutas);
			return rutas.map(() => 'application/x-executable');
		});

		await pregunton.tipoDelArchivo('/usr/bin/a');
		await pregunton.tipoDelArchivo('/usr/bin/b');

		expect(viajes).toEqual([['/usr/bin/a'], ['/usr/bin/b']]);
	});

	test('una respuesta más corta que la tanda no deja a nadie sin tipo', async () => {
		const pregunton = crearPreguntonDeTipos(async () => [null]);

		const tipos = await Promise.all([
			pregunton.tipoDelArchivo('/x/1'),
			pregunton.tipoDelArchivo('/x/2'),
		]);

		expect(tipos).toEqual([SIN_RESOLVER, SIN_RESOLVER]);
	});

	test('un fallo no queda pegado', async () => {
		let falla = true;
		const pregunton = crearPreguntonDeTipos(async (rutas) => {
			if (falla) throw new Error('sin backend');
			return rutas.map(() => 'image/png');
		});

		await expect(pregunton.tipoDelArchivo('/x/1')).rejects.toThrow();
		expect(pregunton.guardados).toBe(0);

		falla = false;

		expect(await pregunton.tipoDelArchivo('/x/1')).toBe('image/png');
	});
});
