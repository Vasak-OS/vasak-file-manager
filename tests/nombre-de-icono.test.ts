import { describe, expect, test } from 'bun:test';
import { FILE_EXTENSIONS } from '../src/constants/file-extensions';
import type { DirEntry } from '../src/types/dir-entry';
import { nombreDeIcono } from '../src/utils/images';

/**
 * Qué icono le toca a cada entrada.
 *
 * Se prueba aparte de pedirlo porque es lo que decide cuántos nombres
 * distintos existen, que es de lo que depende que la caché sirva: si esta
 * función devolviera algo por archivo —el tipo MIME real, por ejemplo— la
 * caché dejaría de colapsar nada.
 */
const entrada = (parcial: Partial<DirEntry>): DirEntry =>
	({ name: 'x', path: '/x', is_dir: false, ...parcial }) as DirEntry;

describe('nombreDeIcono', () => {
	test('una carpeta es una carpeta aunque su nombre tenga extensión', () => {
		expect(nombreDeIcono(entrada({ is_dir: true, ext: 'mp3' }))).toBe('folder');
	});

	test('sin extensión, el genérico', () => {
		expect(nombreDeIcono(entrada({ ext: undefined }))).toBe('application-rtf');
		expect(nombreDeIcono(entrada({ ext: '' }))).toBe('application-rtf');
	});

	test('la extensión no distingue mayúsculas', () => {
		const minuscula = FILE_EXTENSIONS.IMAGE[0];

		expect(nombreDeIcono(entrada({ ext: minuscula.toUpperCase() }))).toBe('image-x-generic');
	});

	test('cada familia tiene el suyo', () => {
		const esperado: [readonly string[], string][] = [
			[FILE_EXTENSIONS.IMAGE, 'image-x-generic'],
			[FILE_EXTENSIONS.VIDEO, 'video-x-generic'],
			[FILE_EXTENSIONS.AUDIO, 'audio-x-generic'],
			[FILE_EXTENSIONS.CODE, 'application-vnd.nokia.xml.qt.resource'],
			[FILE_EXTENSIONS.ARCHIVE, 'application-x-archive'],
			[FILE_EXTENSIONS.TEXT, 'text-x-generic'],
		];

		for (const [familia, nombre] of esperado) {
			expect(nombreDeIcono(entrada({ ext: familia[0] }))).toBe(nombre);
		}
	});

	test('lo desconocido cae en el genérico', () => {
		expect(nombreDeIcono(entrada({ ext: 'qwertyuiop' }))).toBe('application-rtf');
	});

	/**
	 * El número que hace que la caché valga la pena: con cualquier directorio,
	 * los nombres posibles son estos ocho y nada más.
	 */
	test('no hay más de ocho nombres posibles', () => {
		const todas = [
			undefined,
			'qwertyuiop',
			...FILE_EXTENSIONS.IMAGE,
			...FILE_EXTENSIONS.VIDEO,
			...FILE_EXTENSIONS.AUDIO,
			...FILE_EXTENSIONS.CODE,
			...FILE_EXTENSIONS.ARCHIVE,
			...FILE_EXTENSIONS.TEXT,
		];

		const nombres = new Set(todas.map((ext) => nombreDeIcono(entrada({ ext }))));
		nombres.add(nombreDeIcono(entrada({ is_dir: true })));

		expect(nombres.size).toBe(8);
	});
});
