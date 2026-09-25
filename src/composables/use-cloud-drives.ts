import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ref } from 'vue';
import { cloudMountErrorMessage } from '@/utils/cloud-mount-error';

/** Un disco en la nube de las cuentas en línea. */
export interface CloudDrive {
	id: string;
	name: string;
	provider: string;
	/**
	 * Si hay que reconectarla desde Configuración antes de poder abrirla.
	 *
	 * Se muestra igual: una cuenta que desaparece de la lista parece una cuenta
	 * que se borró, y la persona no sabría que le falta hacer algo.
	 */
	needsReconnect: boolean;
	/**
	 * Si los archivos de este proveedor todavía no se pueden abrir en VasakOS.
	 *
	 * Google Drive se ofrece como capacidad `drive` pero no habla WebDAV, y la
	 * API propia no está implementada: lo no implementado se ve «todavía no
	 * disponible», nunca roto. Se muestra igual, por el mismo motivo que la de
	 * arriba, y no se monta.
	 */
	unavailable: boolean;
}

/**
 * Los discos en la nube de las cuentas conectadas.
 *
 * Listar no pide permiso —son metadatos, y el servicio ya acota lo que devuelve
 * a quien pregunta—. El permiso se pide al **abrir** uno, que es cuando hace
 * falta la credencial.
 */
export function useCloudDrives() {
	const { t } = useI18n();
	const drives = ref<CloudDrive[]>([]);
	const error = ref('');
	/** El que se está montando, para no dejar el botón sin respuesta. */
	const mounting = ref('');

	async function refresh() {
		try {
			error.value = '';
			drives.value = await invoke<CloudDrive[]>('list_cloud_drives');
		} catch (e) {
			// Que no esté el servicio de cuentas no es un fallo del gestor de
			// archivos: simplemente no hay discos en la nube que mostrar. Se
			// guarda el motivo y la lista queda vacía.
			error.value = String(e);
			drives.value = [];
		}
	}

	/**
	 * Monta el disco y devuelve la ruta donde quedó, o `null` si no se pudo.
	 *
	 * La primera vez que se abre uno, la persona ve el diálogo de permiso del
	 * sistema: este programa pide `drive` y nada más.
	 *
	 * Recibe el disco y no sólo su id porque el mensaje de un fallo lo nombra:
	 * el backend contesta un código, y es acá donde se vuelve texto traducido.
	 */
	async function mount(drive: CloudDrive): Promise<string | null> {
		mounting.value = drive.id;
		error.value = '';
		try {
			return await invoke<string>('mount_cloud_drive', { accountId: drive.id });
		} catch (e) {
			error.value = cloudMountErrorMessage(e, drive, t);
			return null;
		} finally {
			mounting.value = '';
		}
	}

	return { drives, error, mounting, refresh, mount };
}
