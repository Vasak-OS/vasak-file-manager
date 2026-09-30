/**
 * El mensaje de una carpeta de red que no se pudo montar.
 *
 * `sshfs` es opcional desde #105: quien pide montar por SSH sin tenerlo tiene
 * que leer qué paquete falta, en su idioma, y no un error de Rust en inglés.
 */

import { describe, expect, test } from 'bun:test';
import { networkMountErrorMessage } from '@/utils/network-mount-error';

/** Un `t()` como el del taller: no interpola. */
const t = (clave: string) =>
	({
		networkMountMissingPackage: 'Falta instalar el paquete {0} para montar esta carpeta',
		networkMountFailed: 'No se pudo montar la carpeta de red: {0}',
	})[clave] ?? clave;

describe('el mensaje de una carpeta de red que no se pudo montar', () => {
	test('sin sshfs dice qué paquete instalar', () => {
		expect(networkMountErrorMessage({ code: 'missingPackage', detail: 'sshfs' }, t)).toBe(
			'Falta instalar el paquete sshfs para montar esta carpeta'
		);
	});

	test('un fallo del programa lleva el detalle tal cual', () => {
		expect(
			networkMountErrorMessage({ code: 'failed', detail: 'sshfs failed: Connection refused' }, t)
		).toBe('No se pudo montar la carpeta de red: sshfs failed: Connection refused');
	});

	test('un código desconocido no se traga: se dice como fallo', () => {
		expect(networkMountErrorMessage({ code: 'otroCodigo', detail: 'x' }, t)).toBe(
			'No se pudo montar la carpeta de red: x'
		);
	});

	test('un error que llega como texto, de un backend viejo, se muestra igual', () => {
		expect(networkMountErrorMessage('Unknown protocol: ftp', t)).toBe(
			'No se pudo montar la carpeta de red: Unknown protocol: ftp'
		);
	});

	test('un objeto sin código se muestra entero y no como [object Object]', () => {
		expect(networkMountErrorMessage({ message: 'x' }, t)).toBe(
			'No se pudo montar la carpeta de red: {"message":"x"}'
		);
		expect(networkMountErrorMessage(new Error('se cortó'), t)).toBe(
			'No se pudo montar la carpeta de red: se cortó'
		);
	});

	test('un detalle con $& sale tal cual', () => {
		// El detalle lo escribe el servidor remoto: `replace` con cadena lo
		// cambiaría.
		expect(networkMountErrorMessage({ code: 'failed', detail: 'a $& b' }, t)).toBe(
			'No se pudo montar la carpeta de red: a $& b'
		);
	});

	test('las dos claves existen en los dos idiomas', async () => {
		for (const idioma of ['es', 'en']) {
			const texto = await Bun.file(`src-tauri/locales/${idioma}.yml`).text();
			expect(texto).toMatch(/^networkMountMissingPackage: ".*\{0\}.*"$/m);
			expect(texto).toMatch(/^networkMountFailed: ".*\{0\}.*"$/m);
		}
	});
});
