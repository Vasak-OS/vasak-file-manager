import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ref } from 'vue';
import { toast } from '@/components/ui/toast/toaster';
import { useDrives } from '@/composables/use-drives';
import { avisoDeFallo, CLAVES_DE_RENOMBRE } from '@/tools/aviso-de-montaje';
import type { DriveInfo } from '@/types/drive-info';

/**
 * Renombrar la etiqueta de un volumen.
 *
 * El estado es del módulo y no de un componente: quien lo pide es la tarjeta de
 * la unidad, que vive dentro de un tooltip y se desmonta cuando el puntero se
 * va al menú nativo; el diálogo lo muestra la barra lateral, que no se desmonta.
 */
const isOpen = ref(false);
const value = ref('');
let devicePath = '';

/** Abre el diálogo precargado con el nombre actual (aproximado: `DriveInfo.name`). */
export function requestRename(drive: DriveInfo) {
	devicePath = drive.device_path;
	value.value = drive.name;
	isOpen.value = true;
}

export function useRenameVolumeLabel() {
	const { t } = useI18n();
	const { refresh } = useDrives();

	async function confirm(label: string) {
		isOpen.value = false;
		if (!label || !devicePath) return;

		try {
			await invoke<void>('set_volume_label', { devicePath, label });
			toast.success({ title: t('drive.labelChanged') });
			await refresh();
		} catch (renameError) {
			console.error('Failed to rename volume label:', renameError);
			const aviso = avisoDeFallo(renameError, CLAVES_DE_RENOMBRE);
			// Cancelar la autorización no es un fallo: no se avisa nada.
			if (aviso) {
				toast.error({ title: t(aviso.claveDelTitulo), description: aviso.detalle, duration: 6000 });
			}
		}
	}

	return { isOpen, value, confirm };
}
