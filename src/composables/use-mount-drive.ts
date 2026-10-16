import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { toast } from '@/components/ui/toast/toaster';
import { avisoDeFallo } from '@/tools/aviso-de-montaje';
import type { DriveInfo } from '@/types/drive-info';

/**
 * Montar una unidad y avisar si no sale, desde cualquier lugar que la muestre.
 *
 * Vivía sólo en la tarjeta de la unidad, y la barra lateral —que es donde se hace
 * clic— abría la ruta de la unidad, vacía si no está montada: no montaba, no
 * navegaba y no decía nada.
 */
/** Un montaje en curso por dispositivo: un doble clic no abre dos diálogos de contraseña. */
const inFlight = new Map<string, Promise<string | null>>();

export function useMountDrive() {
	const { t } = useI18n();

	/** Devuelve dónde quedó montada, o `null` si no se pudo (y ya se avisó). */
	function mountDrive(drive: DriveInfo): Promise<string | null> {
		const pending = inFlight.get(drive.device_path);
		if (pending) return pending;
		const request = mount(drive).finally(() => inFlight.delete(drive.device_path));
		inFlight.set(drive.device_path, request);
		return request;
	}

	async function mount(drive: DriveInfo): Promise<string | null> {
		try {
			const mountPoint = await invoke<string>('mount_drive', { devicePath: drive.device_path });
			// Montado pero sin saber dónde: sin esto el clic no hacía nada visible.
			if (!mountPoint) throw new Error('el montaje no devolvió dónde quedó la unidad');
			return mountPoint;
		} catch (mountError) {
			console.error('Failed to mount drive:', mountError);
			const aviso = avisoDeFallo(mountError);
			// Cerrar el diálogo de la contraseña no es un fallo: no se avisa nada.
			if (aviso) {
				toast.error({
					title: t(aviso.claveDelTitulo),
					description: aviso.detalle,
					duration: 6000,
				});
			}
			return null;
		}
	}

	return { mountDrive };
}
