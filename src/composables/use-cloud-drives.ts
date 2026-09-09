import { invoke } from '@tauri-apps/api/core';
import { ref } from 'vue';

/** Un disco en la nube de las cuentas en línea. */
export interface CloudDrive {
	id: string;
	nombre: string;
	proveedor: string;
	/**
	 * Si hay que reconectarla desde Configuración antes de poder abrirla.
	 *
	 * Se muestra igual: una cuenta que desaparece de la lista parece una cuenta
	 * que se borró, y la persona no sabría que le falta hacer algo.
	 */
	necesita_reconectarse: boolean;
}

/**
 * Los discos en la nube de las cuentas conectadas.
 *
 * Listar no pide permiso —son metadatos, y el servicio ya acota lo que devuelve
 * a quien pregunta—. El permiso se pide al **abrir** uno, que es cuando hace
 * falta la credencial.
 */
export function useCloudDrives() {
	const drives = ref<CloudDrive[]>([]);
	const error = ref('');
	/** El que se está montando, para no dejar el botón sin respuesta. */
	const montando = ref('');

	async function refresh() {
		try {
			error.value = '';
			drives.value = await invoke<CloudDrive[]>('listar_discos_en_la_nube');
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
	 */
	async function mount(id: string): Promise<string | null> {
		montando.value = id;
		error.value = '';
		try {
			return await invoke<string>('montar_disco_en_la_nube', { accountId: id });
		} catch (e) {
			error.value = String(e);
			return null;
		} finally {
			montando.value = '';
		}
	}

	return { drives, error, montando, refresh, mount };
}
