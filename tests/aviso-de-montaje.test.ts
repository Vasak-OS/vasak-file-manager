import { describe, expect, test } from 'bun:test';
import { avisoDeFallo, CLAVES_DE_RENOMBRE } from '@/tools/aviso-de-montaje';

describe('avisoDeFallo', () => {
	test('cerrar el diálogo de la contraseña no muestra nada', () => {
		// Es una respuesta, no un fallo: un cartel de error ahí le dice a la
		// persona que algo salió mal cuando hizo exactamente lo que quería.
		expect(avisoDeFallo({ codigo: 'cancelled', detalle: 'se cerró el diálogo' })).toBeNull();
	});

	test('cada motivo tiene su texto', () => {
		expect(avisoDeFallo({ codigo: 'notAuthorized', detalle: '' })?.claveDelTitulo).toBe(
			'drive.mountNotAuthorized'
		);
		expect(avisoDeFallo({ codigo: 'wrongPassphrase', detalle: '' })?.claveDelTitulo).toBe(
			'drive.mountWrongPassphrase'
		);
		expect(avisoDeFallo({ codigo: 'failed', detalle: '' })?.claveDelTitulo).toBe(
			'drive.mountFailed'
		);
	});

	test('el detalle de udisks2 viaja hasta el cartel', () => {
		// No se muestra como título porque viene en inglés, pero es lo único que
		// dice *qué* pasó cuando el motivo es «falló».
		expect(avisoDeFallo({ codigo: 'failed', detalle: 'target is busy' })?.detalle).toBe(
			'target is busy'
		);
	});

	test('un código que no se conoce igual se muestra', () => {
		// Un backend más nuevo que agregue un motivo no puede dejar el clic sin
		// respuesta: eso es exactamente lo que se vino a arreglar.
		expect(avisoDeFallo({ codigo: 'algoNuevo', detalle: 'x' })?.claveDelTitulo).toBe(
			'drive.mountFailed'
		);
	});

	test('un error que no tiene esta forma no se traga', () => {
		// Una excepción de Tauri llega como texto, no como objeto.
		const aviso = avisoDeFallo('command mount_drive not found');

		expect(aviso?.claveDelTitulo).toBe('drive.mountFailed');
		expect(aviso?.detalle).toBe('command mount_drive not found');
	});

	test('ni siquiera un error vacío desaparece en silencio', () => {
		expect(avisoDeFallo(null)?.claveDelTitulo).toBe('drive.mountFailed');
	});
});

describe('avisoDeFallo al renombrar la etiqueta', () => {
	test('cada motivo usa el texto de renombrar y no el de montar', () => {
		expect(
			avisoDeFallo({ codigo: 'notAuthorized', detalle: '' }, CLAVES_DE_RENOMBRE)?.claveDelTitulo
		).toBe('drive.renameNotAuthorized');
		expect(
			avisoDeFallo({ codigo: 'failed', detalle: '' }, CLAVES_DE_RENOMBRE)?.claveDelTitulo
		).toBe('drive.renameFailed');
	});

	test('un motivo que sólo existe al montar cae en el fallo genérico de renombrar', () => {
		// La frase de paso no interviene al renombrar: si llegara, no puede
		// mostrar «frase incorrecta».
		expect(
			avisoDeFallo({ codigo: 'wrongPassphrase', detalle: '' }, CLAVES_DE_RENOMBRE)?.claveDelTitulo
		).toBe('drive.renameFailed');
	});

	test('cancelar tampoco se muestra', () => {
		expect(avisoDeFallo({ codigo: 'cancelled', detalle: '' }, CLAVES_DE_RENOMBRE)).toBeNull();
	});

	test('un error que no tiene esa forma no se traga y el detalle viaja', () => {
		const aviso = avisoDeFallo('boom', CLAVES_DE_RENOMBRE);

		expect(aviso?.claveDelTitulo).toBe('drive.renameFailed');
		expect(aviso?.detalle).toBe('boom');
	});

	test('sin claves propias sigue usando los textos de montar', () => {
		expect(avisoDeFallo({ codigo: 'failed', detalle: '' })?.claveDelTitulo).toBe(
			'drive.mountFailed'
		);
	});
});
