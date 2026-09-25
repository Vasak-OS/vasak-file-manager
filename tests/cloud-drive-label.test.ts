/**
 * La etiqueta de un disco en la nube en la barra lateral.
 *
 * Una cuenta que no se puede abrir no desaparece: lleva el motivo pegado al
 * nombre. Y los dos motivos se dicen distinto, porque piden cosas distintas
 * de la persona: reconectar la arregla; «todavía no disponible» no tiene nada
 * que hacer, y mandarla a reconectar sería mentirle. Eso pasaba con Google
 * Drive antes de este cambio (`vasak-file-manager#95`).
 */

import { describe, expect, test } from 'bun:test';
import type { CloudDrive } from '@/composables/use-cloud-drives';
import { labelOf } from '@/utils/cloud-drive-label';

/** Un `t()` que interpola como el del taller: no interpola. */
const t = (clave: string) =>
	({
		cloudNeedsReconnect: '{0}: hay que volver a conectarla desde Configuración',
		cloudNotAvailableYet: '{0}: todavía no disponible',
	})[clave] ?? clave;

const unaNube = (cambios: Partial<CloudDrive> = {}): CloudDrive => ({
	id: 'cuenta-1',
	name: 'Drive de Pato',
	provider: 'nextcloud',
	needsReconnect: false,
	unavailable: false,
	...cambios,
});

describe('la etiqueta de un disco en la nube', () => {
	test('una que anda es sólo su nombre', () => {
		expect(labelOf(unaNube(), t)).toBe('Drive de Pato');
	});

	test('una que hay que reconectar lo dice, con su nombre', () => {
		expect(labelOf(unaNube({ needsReconnect: true }), t)).toBe(
			'Drive de Pato: hay que volver a conectarla desde Configuración'
		);
	});

	test('una cuyos archivos todavía no están disponibles lo dice, y no manda a reconectar', () => {
		// Reconectar no trae ninguna dirección: decirlo sería mandar a la
		// persona a dar vueltas.
		const etiqueta = labelOf(unaNube({ provider: 'google', unavailable: true }), t);
		expect(etiqueta).toBe('Drive de Pato: todavía no disponible');
		expect(etiqueta).not.toContain('Configuración');
	});

	test('si viene con las dos marcas, gana «todavía no disponible»', () => {
		// Es lo único cierto que se puede decir: reconectarla no la arreglaría.
		expect(labelOf(unaNube({ needsReconnect: true, unavailable: true }), t)).toBe(
			'Drive de Pato: todavía no disponible'
		);
	});

	test('un nombre con símbolos de reemplazo sale entero', () => {
		// `replace` con una cadena interpreta `$&`; el nombre lo elige la
		// persona, así que no es hipotético.
		expect(labelOf(unaNube({ name: 'Rock $& Roll', unavailable: true }), t)).toBe(
			'Rock $& Roll: todavía no disponible'
		);
	});
});
