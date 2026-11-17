/**
 * Una miniatura generada que el `<img>` no puede cargar (el PNG de la caché
 * falta, quedó a medio escribir o no se lee) cae al icono del archivo, y no se
 * vuelve a pedir al backend.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { useVideoThumbnails } from '@/composables/file-browser/use-video-thumbnails';
import type { DirEntry } from '@/types/dir-entry';
import { olvidarTodo, pedidos, responder } from './dobles';

const PDF = {
	name: 'manual.pdf',
	path: '/casa/manual.pdf',
	is_dir: false,
	is_file: true,
	is_hidden: false,
	size: 1024,
	ext: 'pdf',
	item_count: null,
} as DirEntry;

/** Deja correr las promesas pendientes de la generación. */
const asentar = () => new Promise((resolver) => setTimeout(resolver, 0));

describe('miniatura generada que no carga', () => {
	beforeEach(() => {
		olvidarTodo();
		responder('video_thumbnail', '/cache/manual.png');
	});

	test('tras el error de carga la tarjeta cae al icono', async () => {
		const { getVideoThumbnail, onThumbnailError } = useVideoThumbnails();

		getVideoThumbnail(PDF);
		await asentar();
		expect(getVideoThumbnail(PDF)).toContain('manual.png');

		onThumbnailError(PDF);

		expect(getVideoThumbnail(PDF)).toBeUndefined();
	});

	test('tras el error de carga no se vuelve a pedir la miniatura al backend', async () => {
		const { getVideoThumbnail, onThumbnailError } = useVideoThumbnails();

		getVideoThumbnail(PDF);
		await asentar();
		expect(pedidos('video_thumbnail')).toHaveLength(1);

		onThumbnailError(PDF);
		getVideoThumbnail(PDF);
		await asentar();
		getVideoThumbnail(PDF);
		await asentar();

		expect(pedidos('video_thumbnail')).toHaveLength(1);
	});
});
