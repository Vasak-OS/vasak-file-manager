import { interpolar } from '@/tools/interpolar';

/**
 * Qué se le dice a la persona cuando montar una carpeta de red no sale.
 *
 * Mismo criterio que `cloud-mount-error.ts`: `mount_network_share` contesta un
 * código y la ventana lo traduce. El caso que importa es `missingPackage`:
 * `sshfs` es opcional en las dos recetas (#105), así que falta en cualquier
 * sistema donde nadie lo instaló, y quien pidió montar por SSH tiene que saber
 * qué instalar. Antes volvía «Failed to run sshfs: … Is sshfs installed?», en
 * inglés y sin decir el paquete.
 */

/** Lo que devuelve `mount_network_share` cuando falla. */
export interface NetworkMountError {
	code: string;
	detail: string;
}

function isNetworkMountError(value: unknown): value is NetworkMountError {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as NetworkMountError).code === 'string'
	);
}

/**
 * El texto traducido de un fallo al montar una carpeta de red.
 *
 * Un código desconocido o un error sin forma —una excepción de Tauri, un
 * backend más viejo que devolvía texto— se dice con `networkMountFailed` y el
 * detalle tal cual, en vez de tragárselo.
 */
export function networkMountErrorMessage(error: unknown, t: (key: string) => string): string {
	if (isNetworkMountError(error)) {
		if (error.code === 'missingPackage') {
			return interpolar(t('networkMountMissingPackage'), error.detail ?? '');
		}
		return interpolar(t('networkMountFailed'), error.detail ?? '');
	}
	return interpolar(t('networkMountFailed'), detailOf(error));
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
