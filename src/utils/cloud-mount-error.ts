import type { CloudDrive } from '@/composables/use-cloud-drives';
import { interpolar } from '@/tools/interpolar';
import { labelOf } from '@/utils/cloud-drive-label';

/**
 * Qué se le dice a la persona cuando abrir un disco en la nube no sale.
 *
 * El backend contesta con un código y no con un texto, igual que al montar
 * las unidades locales: no sabe en qué idioma está la ventana, y un mensaje
 * escrito del lado de Rust salía en español para todo el mundo. Acá el código
 * se vuelve texto traducido.
 */

/** Lo que devuelve `mount_cloud_drive` cuando falla. */
export interface CloudMountError {
	code: string;
	detail: string;
}

function isCloudMountError(value: unknown): value is CloudMountError {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as CloudMountError).code === 'string'
	);
}

/** El detalle de algo que no tiene la forma esperada, sin perderlo. */
function detailOf(error: unknown): string {
	if (typeof error === 'string') return error;
	if (error instanceof Error) return error.message;
	if (typeof error === 'object' && error !== null) {
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	}
	return String(error ?? '');
}

/**
 * El texto traducido de un fallo al abrir `drive`.
 *
 * - `notAvailableYet` y `needsReconnect` dicen lo mismo que la etiqueta del
 *   disco en la barra lateral: es el mismo motivo, visto desde el clic.
 * - `failed`, un código que esta ventana no conoce, o un error sin forma —una
 *   excepción de Tauri, un backend más viejo que devolvía texto— se dicen con
 *   `cloudMountFailed`, el nombre del disco y el detalle tal cual. Tragárselo
 *   sería volver al clic que no hace nada.
 *
 * El `t()` del taller no interpola, así que los valores se meten después, con
 * `interpolar` y no con `replace`: el nombre lo elige la persona y el detalle
 * viene de un servidor, y un `$&` en cualquiera de los dos saldría cambiado.
 */
export function cloudMountErrorMessage(
	error: unknown,
	drive: CloudDrive,
	t: (key: string) => string
): string {
	if (isCloudMountError(error)) {
		if (error.code === 'notAvailableYet') {
			return labelOf({ ...drive, unavailable: true }, t);
		}
		if (error.code === 'needsReconnect') {
			return labelOf({ ...drive, unavailable: false, needsReconnect: true }, t);
		}
		return interpolar(t('cloudMountFailed'), drive.name, error.detail ?? '');
	}
	return interpolar(t('cloudMountFailed'), drive.name, detailOf(error));
}
