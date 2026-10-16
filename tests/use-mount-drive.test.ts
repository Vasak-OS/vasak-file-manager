/**
 * `useMountDrive`: montar una unidad y avisar si no sale.
 *
 * Lo que se comprueba es lo que la persona nota: un doble clic no pide dos
 * veces la contraseña, y un montaje sin destino no es un clic que no hace nada.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { toast, useToast } from '@/components/ui/toast/toaster';
import { useMountDrive } from '@/composables/use-mount-drive';
import type { DriveInfo } from '@/types/drive-info';
import { olvidarTodo, pedidos, responder } from './dobles';

function unDisco(device_path = '/dev/nvme0n1p3'): DriveInfo {
	return {
		name: 'Datos',
		path: '',
		mount_point: '',
		file_system: 'ext4',
		drive_type: 'Fixed',
		total_space: 1,
		available_space: 1,
		used_space: 0,
		percent_used: 0,
		is_removable: false,
		is_read_only: false,
		is_mounted: false,
		is_encrypted: false,
		device_path,
	} as DriveInfo;
}

/** Una respuesta que la prueba resuelve cuando quiere. */
function pendiente() {
	let resolver: (valor: string) => void = () => {};
	const promesa = new Promise<string>((ok) => {
		resolver = ok;
	});
	return { promesa, resolver };
}

beforeEach(() => {
	olvidarTodo();
	toast.dismissAll();
});

describe('un montaje sin destino', () => {
	test('es un fallo: avisa con un cartel de error y devuelve null', async () => {
		responder('mount_drive', () => '');

		const resultado = await useMountDrive().mountDrive(unDisco());

		expect(resultado).toBeNull();
		expect(useToast().toasts.value.size).toBe(1);
	});
});

describe('dos pedidos para la misma unidad', () => {
	test('mientras el primero espera, se monta una sola vez y ambos reciben lo mismo', async () => {
		const { promesa, resolver } = pendiente();
		responder('mount_drive', () => promesa);
		const { mountDrive } = useMountDrive();

		const primero = mountDrive(unDisco());
		const segundo = mountDrive(unDisco());
		resolver('/run/media/pato/DATOS');

		expect(await primero).toBe('/run/media/pato/DATOS');
		expect(await segundo).toBe('/run/media/pato/DATOS');
		expect(pedidos('mount_drive')).toHaveLength(1);
	});

	test('una vez resuelto, un pedido nuevo vuelve a montar', async () => {
		responder('mount_drive', () => '/run/media/pato/DATOS');
		const { mountDrive } = useMountDrive();

		await mountDrive(unDisco());
		await mountDrive(unDisco());

		expect(pedidos('mount_drive')).toHaveLength(2);
	});

	test('unidades distintas no se esperan entre sí', async () => {
		const { promesa, resolver } = pendiente();
		responder('mount_drive', () => promesa);
		const { mountDrive } = useMountDrive();

		const a = mountDrive(unDisco('/dev/sda1'));
		const b = mountDrive(unDisco('/dev/sdb1'));
		resolver('/mnt/x');
		await Promise.all([a, b]);

		expect(pedidos('mount_drive')).toHaveLength(2);
	});
});
