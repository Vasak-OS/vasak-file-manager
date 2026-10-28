/**
 * Progreso por bytes en las copias (#146): el lado de la ventana.
 *
 * El backend emite `file-operation-progress` con `processed_bytes`,
 * `total_bytes` y `bytes_per_second`. Lo que tiene que pasar acá es que la barra
 * avance por bytes cuando se conocen, caiga al conteo de archivos cuando no
 * (mover y borrar mandan los tres en 0), nunca pase de 100 y que el mensaje
 * lleve el nombre y la velocidad.
 *
 * Se corre `runTrackedFileOperation` de verdad: el doble de `invoke` emite los
 * eventos mientras el comando está "en curso" y se mira la operación del centro
 * de estado después de cada uno.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { runTrackedFileOperation } from '@/stores/runtime/file-operation-runner';
import { useStatusCenterStore } from '@/stores/runtime/status-center';
import { emitir, olvidarTodo, responder } from './dobles';

interface Progreso {
	processed: number;
	total: number;
	current: string;
	processed_bytes: number;
	total_bytes: number;
	bytes_per_second: number;
}

const MIB = 1024 * 1024;

/** Un evento de progreso; lo que no se nombra va en 0, como mover y borrar. */
const evento = (campos: Partial<Progreso>): Progreso => ({
	processed: 0,
	total: 0,
	current: '',
	processed_bytes: 0,
	total_bytes: 0,
	bytes_per_second: 0,
	...campos,
});

/**
 * Corre una operación y devuelve (progreso, mensaje) tras cada evento.
 * El comando queda "en curso" mientras se emiten, igual que en el backend.
 */
async function seguir(
	comando: 'copy_items' | 'move_items' | 'delete_items',
	eventos: Partial<Progreso>[]
) {
	const centro = useStatusCenterStore();
	const vistos: Array<{ progress?: number; message?: string }> = [];
	responder(comando, async (argumentos: Record<string, unknown>) => {
		const id = argumentos.operationId as string;
		for (const parcial of eventos) {
			await emitir('file-operation-progress', {
				operation_id: id,
				kind: 'copy',
				...evento(parcial),
			});
			const operacion = centro.operations.get(id);
			vistos.push({ progress: operacion?.progress, message: operacion?.message });
		}
		return { success: true };
	});
	await runTrackedFileOperation(
		comando,
		{ sources: [] },
		{ type: 'copy', label: 'copiar', path: '/destino' }
	);
	return vistos;
}

beforeEach(() => {
	olvidarTodo();
	setActivePinia(createPinia());
});

describe('el porcentaje de la barra', () => {
	test('en una copia avanza por bytes y no por cantidad de archivos', async () => {
		// Un archivo grande de dos: por conteo daría 0 % y por bytes 25 %.
		const vistos = await seguir('copy_items', [
			{ processed: 0, total: 2, processed_bytes: 25 * MIB, total_bytes: 100 * MIB },
		]);
		expect(vistos[0].progress).toBe(25);
	});

	test('redondea al entero más cercano', async () => {
		const vistos = await seguir('copy_items', [
			{ processed_bytes: 1, total_bytes: 3 },
			{ processed_bytes: 2, total_bytes: 3 },
		]);
		expect(vistos.map((visto) => visto.progress)).toEqual([33, 67]);
	});

	test('sin bytes totales (mover, borrar) cae al conteo de archivos', async () => {
		const vistos = await seguir('move_items', [
			{ processed: 1, total: 4 },
			{ processed: 4, total: 4 },
		]);
		expect(vistos.map((visto) => visto.progress)).toEqual([25, 100]);
	});

	test('si los bytes totales son 0 no se divide por cero y se usa el conteo', async () => {
		const vistos = await seguir('copy_items', [
			{ processed: 1, total: 2, processed_bytes: 0, total_bytes: 0 },
		]);
		expect(vistos[0].progress).toBe(50);
	});

	test('sin bytes ni archivos totales la barra queda en 0', async () => {
		const vistos = await seguir('delete_items', [{ processed: 0, total: 0 }]);
		expect(vistos[0].progress).toBe(0);
	});

	test('no pasa de 100 cuando los bytes copiados superan al total', async () => {
		// `total_bytes` no cuenta los symlinks que se siguen al copiar: el total
		// puede quedar corto y lo copiado pasarlo.
		const vistos = await seguir('copy_items', [{ processed_bytes: 150, total_bytes: 100 }]);
		expect(vistos[0].progress).toBe(100);
	});

	test('el evento final de la copia deja la barra en 100', async () => {
		const vistos = await seguir('copy_items', [
			{ processed: 0, total: 2, processed_bytes: 10, total_bytes: 40 },
			{ processed: 2, total: 2, processed_bytes: 40, total_bytes: 40 },
		]);
		expect(vistos.map((visto) => visto.progress)).toEqual([25, 100]);
	});

	test('ignora los eventos de otra operación', async () => {
		const centro = useStatusCenterStore();
		let progreso: number | undefined;
		responder('copy_items', async (argumentos: Record<string, unknown>) => {
			const id = argumentos.operationId as string;
			await emitir('file-operation-progress', {
				operation_id: 'otra-operacion',
				kind: 'copy',
				...evento({ processed_bytes: 90, total_bytes: 100 }),
			});
			progreso = centro.operations.get(id)?.progress;
			return { success: true };
		});
		await runTrackedFileOperation(
			'copy_items',
			{},
			{ type: 'copy', label: 'copiar', path: '/destino' }
		);
		expect(progreso).toBe(0);
	});
});

describe('el mensaje de la operación', () => {
	test('lleva el nombre del archivo y la velocidad cuando se conoce', async () => {
		const vistos = await seguir('copy_items', [
			{
				current: '/home/pato/Videos/pelicula.mkv',
				processed_bytes: MIB,
				total_bytes: 10 * MIB,
				bytes_per_second: 5 * MIB,
			},
		]);
		expect(vistos[0].message).toBe('pelicula.mkv · 5.0 MB/s');
	});

	test('la velocidad usa la unidad que corresponde', async () => {
		const vistos = await seguir('copy_items', [
			{ current: '/a/b.bin', processed_bytes: 1, total_bytes: 2, bytes_per_second: 512 },
			{ current: '/a/b.bin', processed_bytes: 1, total_bytes: 2, bytes_per_second: 1536 },
		]);
		expect(vistos.map((visto) => visto.message)).toEqual(['b.bin · 512 B/s', 'b.bin · 1.5 KB/s']);
	});

	test('sin velocidad (mover, borrar) sólo lleva el nombre, sin separador', async () => {
		const vistos = await seguir('move_items', [
			{ current: '/home/pato/Documentos/', processed: 1, total: 2 },
		]);
		expect(vistos[0].message).toBe('Documentos');
	});

	test('con velocidad pero sin archivo actual sólo lleva la velocidad', async () => {
		// El evento final y el del camino elevado mandan `current` vacío.
		const vistos = await seguir('copy_items', [
			{ current: '', processed_bytes: MIB, total_bytes: MIB, bytes_per_second: 2 * MIB },
		]);
		expect(vistos[0].message).toBe('2.0 MB/s');
	});

	test('sin nombre ni velocidad no hay mensaje', async () => {
		const vistos = await seguir('copy_items', [{ processed_bytes: 1, total_bytes: 2 }]);
		expect(vistos[0].message).toBeUndefined();
	});
});
