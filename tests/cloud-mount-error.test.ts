/**
 * El mensaje de un disco en la nube que no se pudo abrir.
 *
 * El backend contesta un código (`vasak-file-manager#95`) y la ventana lo
 * traduce. Antes llegaba un texto en español fijo, que salía igual con la
 * ventana en inglés.
 */

import { describe, expect, test } from 'bun:test';
import type { CloudDrive } from '@/composables/use-cloud-drives';
import { cloudMountErrorMessage } from '@/utils/cloud-mount-error';

/** Un `t()` como el del taller: no interpola. */
const t = (clave: string) =>
	({
		cloudNeedsReconnect: '{0}: hay que volver a conectarla desde Configuración',
		cloudNotAvailableYet: '{0}: todavía no disponible',
		cloudMountFailed: 'No se pudo abrir {0}: {1}',
	})[clave] ?? clave;

const unaNube = (cambios: Partial<CloudDrive> = {}): CloudDrive => ({
	id: 'cuenta-1',
	name: 'Drive de Pato',
	provider: 'nextcloud',
	needsReconnect: false,
	unavailable: false,
	...cambios,
});

describe('el mensaje de un disco en la nube que no se pudo abrir', () => {
	test('«todavía no disponible» dice lo mismo que la etiqueta, sin mandar a reconectar', () => {
		const mensaje = cloudMountErrorMessage(
			{ code: 'notAvailableYet', detail: 'google: sin dirección WebDAV' },
			unaNube({ provider: 'google' }),
			t
		);
		expect(mensaje).toBe('Drive de Pato: todavía no disponible');
		expect(mensaje).not.toContain('Configuración');
	});

	test('«hay que reconectarla» manda a Configuración, aunque el disco no viniera marcado', () => {
		// El servidor puede rechazar la contraseña de una cuenta que la lista
		// daba por buena: el código manda sobre la marca vieja.
		expect(cloudMountErrorMessage({ code: 'needsReconnect', detail: 'denied' }, unaNube(), t)).toBe(
			'Drive de Pato: hay que volver a conectarla desde Configuración'
		);
	});

	test('un fallo lleva el nombre del disco y el detalle tal cual', () => {
		expect(
			cloudMountErrorMessage(
				{ code: 'failed', detail: 'no se pudo llegar al servidor' },
				unaNube(),
				t
			)
		).toBe('No se pudo abrir Drive de Pato: no se pudo llegar al servidor');
	});

	test('un código que la ventana no conoce se dice como fallo, con su detalle', () => {
		expect(cloudMountErrorMessage({ code: 'algoNuevo', detail: 'x' }, unaNube(), t)).toBe(
			'No se pudo abrir Drive de Pato: x'
		);
	});

	test('un texto suelto —un backend viejo— no se traga', () => {
		expect(cloudMountErrorMessage('ListAccounts: el servicio no contesta', unaNube(), t)).toBe(
			'No se pudo abrir Drive de Pato: ListAccounts: el servicio no contesta'
		);
	});

	test('un objeto raro se muestra entero en vez de «[object Object]»', () => {
		const mensaje = cloudMountErrorMessage({ motivo: 'raro' }, unaNube(), t);
		expect(mensaje).toBe('No se pudo abrir Drive de Pato: {"motivo":"raro"}');
		expect(mensaje).not.toContain('[object Object]');
	});

	test('una excepción muestra su mensaje, y nada no dice «undefined»', () => {
		expect(cloudMountErrorMessage(new Error('se cayó'), unaNube(), t)).toBe(
			'No se pudo abrir Drive de Pato: se cayó'
		);
		expect(cloudMountErrorMessage(undefined, unaNube(), t)).toBe(
			'No se pudo abrir Drive de Pato: '
		);
	});

	test('un nombre o un detalle con símbolos de reemplazo salen enteros', () => {
		// El nombre lo elige la persona y el detalle viene de un servidor; con
		// `replace` y una cadena, `$&` saldría cambiado.
		expect(
			cloudMountErrorMessage(
				{ code: 'failed', detail: 'ruta $& rara {0}' },
				unaNube({ name: 'Rock $& Roll' }),
				t
			)
		).toBe('No se pudo abrir Rock $& Roll: ruta $& rara {0}');
	});
});
