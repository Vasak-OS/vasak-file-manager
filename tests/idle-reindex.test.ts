import { describe, expect, test } from 'bun:test';
import {
	type CondicionesDeReindexado,
	debeReindexar,
	type EstadoDeInactividadDelSistema,
	leerSenal,
	RED_DE_SEGURIDAD_MS,
} from '@/stores/runtime/idle-reindex';

/** El caso que sí autoriza a reindexar; cada test rompe una condición. */
const TODO_EN_ORDEN: CondicionesDeReindexado = {
	senal: 'inactiva',
	escaneoEnCurso: false,
	inicializado: true,
	indiceVencido: true,
};

function estadoDelSistema(
	campos: Partial<EstadoDeInactividadDelSistema>
): EstadoDeInactividadDelSistema {
	return {
		available: true,
		is_idle: false,
		idle_for_ms: 0,
		threshold_ms: 60_000,
		...campos,
	};
}

describe('leerSenal', () => {
	test('sin señal del sistema la respuesta es «no sé», no «hay alguien»', () => {
		// La distinción entera del cambio. Si esto devolviera 'activa', un
		// escritorio sin el protocolo se vería igual que uno con la sesión en
		// uso, y no habría forma de notar que la señal falta.
		expect(leerSenal(estadoDelSistema({ available: false, is_idle: true }))).toBe('desconocida');
		expect(leerSenal(null)).toBe('desconocida');
		expect(leerSenal(undefined)).toBe('desconocida');
	});

	test('con señal se informa lo que dice el compositor', () => {
		expect(leerSenal(estadoDelSistema({ is_idle: true, idle_for_ms: 61_000 }))).toBe('inactiva');
		expect(leerSenal(estadoDelSistema({ is_idle: false }))).toBe('activa');
	});

	test('el umbral lo aplica el sistema, no se vuelve a comprobar acá', () => {
		// El compositor avisa una vez cruzado el umbral: si llegó el aviso, el
		// tiempo ya pasó. Comparar de nuevo contra un umbral propio sólo podría
		// contradecir a quien sí recibe la entrada.
		const recienAvisado = estadoDelSistema({ is_idle: true, idle_for_ms: 60_000 });
		expect(leerSenal(recienAvisado)).toBe('inactiva');
	});
});

describe('debeReindexar', () => {
	test('sesión inactiva, índice vencido y nada en curso: se reindexa', () => {
		expect(debeReindexar(TODO_EN_ORDEN)).toBe(true);
	});

	test('con la sesión en uso no se toca el disco', () => {
		// El error original: la ventana tapada no recibe eventos de entrada, así
		// que se daba por inactiva la sesión al minuto y arrancaba un recorrido
		// completo del sistema de archivos mientras la persona trabajaba.
		expect(debeReindexar({ ...TODO_EN_ORDEN, senal: 'activa' })).toBe(false);
	});

	test('sin saber si hay alguien tampoco se toca el disco', () => {
		// «No sé» pesa como «hay alguien». Un índice viejo hasta el próximo
		// arranque es un buscador peor un rato; un escaneo del disco entero
		// mientras alguien trabaja es una máquina que se arrastra.
		expect(debeReindexar({ ...TODO_EN_ORDEN, senal: 'desconocida' })).toBe(false);
	});

	test('un escaneo ya en curso no se duplica', () => {
		expect(debeReindexar({ ...TODO_EN_ORDEN, escaneoEnCurso: true })).toBe(false);
	});

	test('sin inicializar no se sabe qué tiene el índice', () => {
		expect(debeReindexar({ ...TODO_EN_ORDEN, inicializado: false })).toBe(false);
	});

	test('un índice al día no se rehace', () => {
		expect(debeReindexar({ ...TODO_EN_ORDEN, indiceVencido: false })).toBe(false);
	});

	test('la inactividad sola no alcanza', () => {
		// Cada condición veta por su cuenta: ninguna combinación con algo
		// pendiente pasa sólo por estar la sesión libre.
		const vetos: Array<Partial<CondicionesDeReindexado>> = [
			{ escaneoEnCurso: true },
			{ inicializado: false },
			{ indiceVencido: false },
		];

		for (const veto of vetos) {
			expect(debeReindexar({ ...TODO_EN_ORDEN, ...veto })).toBe(false);
		}
	});
});

describe('RED_DE_SEGURIDAD_MS', () => {
	test('despierta con menos frecuencia que el umbral de inactividad', () => {
		// Sólo cubre el caso de un índice que se vence con la sesión ya
		// inactiva, donde nadie está esperando el resultado. Si fuera más
		// seguido que el propio umbral, sería un sondeo disfrazado.
		expect(RED_DE_SEGURIDAD_MS).toBeGreaterThan(60_000);
	});
});
