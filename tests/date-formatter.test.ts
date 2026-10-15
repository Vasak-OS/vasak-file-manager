/**
 * El formato de la fecha de «modificado».
 *
 * `formatDate` se llama por celda de la columna de fecha. Antes cada llamada
 * armaba su propio `Intl.DateTimeFormat` —por dentro de
 * `toLocaleString(undefined, …)`— y con una carpeta grande eso son cientos de
 * formateadores idénticos por dibujado. Ahora hay uno memoizado por variante
 * —con segundos y sin— y la salida tiene que ser exactamente la misma.
 *
 * De ahí las dos pruebas: una fija que el texto no cambió ni un carácter, la
 * otra que el formateador se arma una sola vez por variante y no por llamada.
 * La de la salida sola pasaría con el código viejo: es una guarda. La que
 * distingue el arreglo es la del conteo.
 */

import { describe, expect, test } from 'bun:test';
import { formatDate } from '../src/utils/date-formatter';

/** Instantes surtidos: época, milisegundos, un año bisiesto, fin de año. */
const INSTANTS = [
	1,
	1000,
	946684800000, // 2000-01-01
	1078012800123, // 2004-02-29, bisiesto
	1735689600000, // 2025-01-01
	1767225599999, // 2025-12-31
];

function legacyOptions(withSeconds: boolean): Intl.DateTimeFormatOptions {
	const options: Intl.DateTimeFormatOptions = {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	};

	if (withSeconds) {
		options.second = '2-digit';
	}

	return options;
}

describe('el texto de la fecha de «modificado»', () => {
	test('es el mismo que armaba `toLocaleString`, en las dos variantes', () => {
		for (const instant of INSTANTS) {
			for (const withSeconds of [false, true]) {
				// El camino viejo, tal cual: `new Date(ts).toLocaleString(undefined, …)`.
				const legacy = new Date(instant).toLocaleString(undefined, legacyOptions(withSeconds));

				expect(formatDate(instant, withSeconds)).toBe(legacy);
			}
		}
	});

	test('sin marca de tiempo devuelve un guion, con y sin segundos', () => {
		// `0` es «no hay fecha» y no el 1 de enero de 1970.
		expect(formatDate(0)).toBe('-');
		expect(formatDate(0, true)).toBe('-');
	});
});

describe('el formateador memoizado', () => {
	test('se arma una sola vez por variante, no una vez por llamada', async () => {
		// Se cuenta la construcción del `Intl.DateTimeFormat` global. El camino
		// viejo llama a `Date.prototype.toLocaleString`, que no pasa por el
		// constructor visible: esta cuenta queda en cero y la prueba se cae con
		// el mensaje correcto —no hubo ninguna construcción, o sea no hay
		// formateador memoizado—.
		const Original = Intl.DateTimeFormat;
		let constructions = 0;

		class CountingFormatter extends Original {
			constructor(...args: ConstructorParameters<typeof Original>) {
				super(...args);
				constructions++;
			}
		}

		(Intl as { DateTimeFormat: unknown }).DateTimeFormat = CountingFormatter;

		try {
			// Una copia fresca del módulo: así la caché arranca vacía y la
			// cuenta no depende del orden en que corran las otras pruebas.
			const freshModule = await import('../src/utils/date-formatter.ts?formateador-frio');

			for (let round = 0; round < 40; round++) {
				freshModule.formatDate(INSTANTS[round % INSTANTS.length] ?? 1, round % 2 === 0);
			}

			// Dos variantes → dos formateadores, y ninguno más.
			expect(constructions).toBe(2);
		} finally {
			(Intl as { DateTimeFormat: unknown }).DateTimeFormat = Original;
		}
	});
});
