/**
 * Renombrar la etiqueta de un volumen (issue #152).
 *
 * Se comprueba lo que la persona nota: el diálogo abre vacío (el nombre de la
 * unidad es el del punto de montaje, no su etiqueta), una unidad de red no
 * ofrece renombrar, un renombre que sale refresca la lista, y uno que no sale se dice con el
 * texto de «renombrar» —no con el de «montar»—, salvo cancelar, que no es un
 * fallo.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { forgetThemeIcons } from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import DriveCardComponent from '@/components/drive/DriveCardComponent.vue';
import { toast, useToast } from '@/components/ui/toast/toaster';
import { requestRename, useRenameVolumeLabel } from '@/composables/use-rename-volume-label';
import type { DriveInfo } from '@/types/drive-info';
import { olvidarTodo, pedidos, ponerEnElTema, responder } from './dobles';

function unDisco(over: Partial<DriveInfo> = {}): DriveInfo {
	return {
		name: 'Datos',
		path: '/run/media/pato/Datos',
		mount_point: '/run/media/pato/Datos',
		file_system: 'ext4',
		drive_type: 'Fixed',
		total_space: 100,
		available_space: 50,
		used_space: 50,
		percent_used: 50,
		is_removable: false,
		is_read_only: false,
		is_mounted: true,
		is_encrypted: false,
		device_path: '/dev/sdb1',
		...over,
	};
}

/** Los avisos que quedaron en la cola, en orden. */
function avisos() {
	return [...useToast().toasts.value.values()];
}

let consola: ReturnType<typeof spyOn>;
let avisosDeVue: ReturnType<typeof spyOn>;

beforeEach(() => {
	olvidarTodo();
	toast.dismissAll();
	// El composable registra el error en la consola; no es ruido que importe.
	consola = spyOn(console, 'error').mockImplementation(() => {});
	// El composable se llama fuera de un componente (así se prueba sin montar
	// nada): Vue avisa de los ganchos de ciclo de vida de `useDrives`.
	avisosDeVue = spyOn(console, 'warn').mockImplementation(() => {});
	responder('get_system_drives', () => []);
});

afterEach(() => {
	consola.mockRestore();
	avisosDeVue.mockRestore();
});

describe('pedir el renombre', () => {
	test('abre el diálogo vacío y no con el nombre de la unidad', () => {
		const { isOpen, value } = useRenameVolumeLabel();
		value.value = 'resto de otra vez';

		requestRename(unDisco({ name: 'Fotos' }));

		expect(isOpen.value).toBe(true);
		// `name` es el del punto de montaje, no la etiqueta del sistema de
		// archivos: precargarlo y confirmar sin editar pisaría la etiqueta real.
		expect(value.value).toBe('');
	});
});

describe('confirmar el renombre', () => {
	test('una etiqueta vacía no llama al backend y cierra el diálogo', async () => {
		const { isOpen, confirm } = useRenameVolumeLabel();
		requestRename(unDisco());

		await confirm('');

		expect(pedidos('set_volume_label')).toHaveLength(0);
		expect(isOpen.value).toBe(false);
		expect(avisos()).toHaveLength(0);
	});

	test('confirmar el diálogo recién abierto, sin escribir, no pisa la etiqueta', async () => {
		const { value, confirm } = useRenameVolumeLabel();
		requestRename(unDisco({ name: 'Datos' }));

		await confirm(value.value);

		expect(pedidos('set_volume_label')).toHaveLength(0);
	});

	test('con éxito: renombra una vez, cierra, avisa y vuelve a leer las unidades', async () => {
		responder('set_volume_label', () => undefined);
		const { isOpen, confirm } = useRenameVolumeLabel();
		requestRename(unDisco({ device_path: '/dev/nvme0n1p3' }));

		await confirm('NUEVA');

		expect(pedidos('set_volume_label')).toEqual([
			{
				comando: 'set_volume_label',
				argumentos: { devicePath: '/dev/nvme0n1p3', label: 'NUEVA' },
			},
		]);
		expect(isOpen.value).toBe(false);
		expect(avisos().map((a) => [a.kind, a.title])).toEqual([['success', 'drive.labelChanged']]);
		// Sin esto la barra lateral sigue mostrando el nombre viejo.
		expect(pedidos('get_system_drives')).toHaveLength(1);
	});

	test('si falla no se vuelve a leer la lista de unidades', async () => {
		responder('set_volume_label', () => Promise.reject({ codigo: 'failed', detalle: 'x' }));
		const { confirm } = useRenameVolumeLabel();
		requestRename(unDisco());

		await confirm('NUEVA');

		expect(pedidos('get_system_drives')).toHaveLength(0);
	});
});

describe('un renombre que falla', () => {
	async function fallaCon(error: unknown) {
		responder('set_volume_label', () => Promise.reject(error));
		const { isOpen, confirm } = useRenameVolumeLabel();
		requestRename(unDisco());

		await confirm('NUEVA');

		expect(isOpen.value).toBe(false);
		return avisos();
	}

	test('sin autorización dice que no se autorizó, con el texto de renombrar', async () => {
		const [aviso] = await fallaCon({ codigo: 'notAuthorized', detalle: 'polkit' });

		expect(aviso.kind).toBe('error');
		expect(aviso.title).toBe('drive.renameNotAuthorized');
		expect(aviso.description).toBe('polkit');
	});

	test('cancelar la autorización no muestra nada', async () => {
		expect(await fallaCon({ codigo: 'cancelled', detalle: 'se cerró' })).toHaveLength(0);
	});

	test('un fallo de udisks2 lleva su detalle', async () => {
		const [aviso] = await fallaCon({ codigo: 'failed', detalle: 'device is mounted' });

		expect(aviso.title).toBe('drive.renameFailed');
		expect(aviso.description).toBe('device is mounted');
	});

	test('un código que no se conoce igual se muestra como fallo', async () => {
		const [aviso] = await fallaCon({ codigo: 'algoNuevo', detalle: 'x' });

		expect(aviso.title).toBe('drive.renameFailed');
	});

	test('una excepción que no tiene la forma {codigo, detalle} no se traga', async () => {
		const [aviso] = await fallaCon('command set_volume_label not found');

		expect(aviso.title).toBe('drive.renameFailed');
		expect(aviso.description).toBe('command set_volume_label not found');
	});
});

describe('el clic derecho sobre la tarjeta de la unidad', () => {
	let vista: VueWrapper | null = null;

	beforeEach(() => {
		forgetThemeIcons();
		setActivePinia(createPinia());
		ponerEnElTema('drive-harddisk', 'data:image/svg+xml,disco');
	});

	afterEach(() => {
		vista?.unmount();
		vista = null;
		document.body.innerHTML = '';
	});

	/** El renglón «renombrar» del menú, si el menú está en pantalla. */
	function renglonDeRenombrar() {
		return [...document.body.querySelectorAll('*')].find(
			(el) => el.children.length === 0 && el.textContent === 'drive.rename'
		) as HTMLElement | undefined;
	}

	async function clicDerechoSobre(drive: DriveInfo) {
		vista = mount(DriveCardComponent, { attachTo: document.body, props: { drive } });
		await vista.trigger('contextmenu', { clientX: 10, clientY: 10 });
		await new Promise((sigue) => setTimeout(sigue, 0));
	}

	test('ofrece renombrar y elegirlo abre el diálogo vacío', async () => {
		const { isOpen, value } = useRenameVolumeLabel();
		isOpen.value = false;
		await clicDerechoSobre(unDisco({ name: 'Respaldo', device_path: '/dev/sdb1' }));

		const renglon = renglonDeRenombrar();
		expect(renglon).toBeDefined();

		renglon?.click();
		await new Promise((sigue) => setTimeout(sigue, 0));

		expect(isOpen.value).toBe(true);
		expect(value.value).toBe('');
	}, 60000);

	test('una unidad de red no ofrece renombrar: el backend la rechazaría', async () => {
		const { isOpen } = useRenameVolumeLabel();
		isOpen.value = false;
		await clicDerechoSobre(
			unDisco({ name: 'Compartida', drive_type: 'Network', device_path: '//server/share' })
		);

		expect(renglonDeRenombrar()).toBeUndefined();
		expect(isOpen.value).toBe(false);
	}, 60000);

	test('un volumen cifrado sin abrir no ofrece renombrar: no es un sistema de archivos', async () => {
		const { isOpen } = useRenameVolumeLabel();
		isOpen.value = false;
		await clicDerechoSobre(
			unDisco({ name: 'Cifrado', device_path: '/dev/sda3', is_encrypted: true })
		);

		expect(renglonDeRenombrar()).toBeUndefined();
		expect(isOpen.value).toBe(false);
	}, 60000);
});
