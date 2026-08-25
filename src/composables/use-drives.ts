import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, ref } from 'vue';
import type { DriveInfo } from '@/types/drive-info';

/**
 * Cada cuánto se pregunta igual, como respaldo.
 *
 * El backend avisa cuando cambia la tabla de montajes —el kernel lo notifica
 * con `POLLPRI` sobre `/proc/self/mountinfo`, verificado montando y desmontando
 * un tmpfs— así que esto ya no es la vía principal. Queda espaciado y sólo
 * mientras la ventana esté a la vista: es la red por si el aviso no llega en
 * algún entorno raro, no el mecanismo.
 */
const DRIVE_POLL_INTERVAL_MS = 60_000;

/** Lo que el backend emite al cambiar la tabla de montajes. */
const MOUNTS_CHANGED_EVENT = 'drives://changed';

const drives = ref<DriveInfo[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let onVisibilityChange: (() => void) | null = null;
let unlistenMounts: UnlistenFn | null = null;
let listenPromise: Promise<UnlistenFn> | null = null;
let activeSubscribers = 0;
let previousDriveCount = 0;
let isInitialFetch = true;

async function focusWindowOnDriveConnected(newDriveCount: number) {
	const driveCountIncreased = newDriveCount > previousDriveCount;
	const hasPreviousData = previousDriveCount > 0;

	if (hasPreviousData && driveCountIncreased && !isInitialFetch) {
		try {
			const appWindow = getCurrentWindow();
			await appWindow.unminimize();
			await appWindow.show();
			await appWindow.setFocus();
		} catch (focusError) {
			console.error('Failed to focus window:', focusError);
		}
	}

	previousDriveCount = newDriveCount;
	isInitialFetch = false;
}

async function fetchDrives() {
	try {
		const result = await invoke<DriveInfo[]>('get_system_drives');
		drives.value = result;
		error.value = null;

		await focusWindowOnDriveConnected(result.length);
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		error.value = errorMessage;
		console.error('Failed to fetch drives:', err);
	}
}

async function initialFetch() {
	isLoading.value = true;
	await fetchDrives();
	isLoading.value = false;
}

function startPolling() {
	if (pollIntervalId !== null || document.hidden) {
		return;
	}

	pollIntervalId = setInterval(fetchDrives, DRIVE_POLL_INTERVAL_MS);
}

function stopPolling() {
	if (pollIntervalId !== null) {
		clearInterval(pollIntervalId);
		pollIntervalId = null;
	}
}

/**
 * Deja de preguntar por las unidades cuando la ventana no está a la vista.
 *
 * Eran 12 consultas por minuto, para siempre, cada una recorriendo la tabla de
 * montajes del sistema — y la mayor parte del tiempo nadie las mira, porque la
 * ventana está minimizada o en otro escritorio.
 *
 * Esto es el respaldo, no el mecanismo: lo que mantiene la lista al día es el
 * aviso del backend, que escucha `POLLPRI` sobre `/proc/self/mountinfo`. Ver
 * `MOUNTS_CHANGED_EVENT` más abajo.
 */
function watchVisibility() {
	if (onVisibilityChange) {
		return;
	}

	onVisibilityChange = () => {
		if (document.hidden) {
			stopPolling();
			return;
		}
		// Al volver se consulta ya: pudieron enchufar algo mientras no mirábamos.
		void fetchDrives();
		startPolling();
	};

	document.addEventListener('visibilitychange', onVisibilityChange);
}

function unwatchVisibility() {
	if (onVisibilityChange) {
		document.removeEventListener('visibilitychange', onVisibilityChange);
		onVisibilityChange = null;
	}
}

async function refresh() {
	await fetchDrives();
}

function getDriveByPath(path: string): DriveInfo | null {
	const normalizedPath = path.toUpperCase();

	return (
		drives.value.find((drive) => {
			const drivePath = drive.path.toUpperCase();
			return (
				drivePath === normalizedPath ||
				drivePath === normalizedPath.replace(/\/$/, '') ||
				`${drivePath}/` === normalizedPath
			);
		}) ?? null
	);
}

export function useDrives() {
	onMounted(() => {
		activeSubscribers++;

		if (activeSubscribers === 1) {
			initialFetch();
			// Esto es lo que de verdad mantiene la lista al día: llega en cuanto
			// se enchufa algo, y no cuesta nada mientras no pasa nada. Se escucha
			// aunque la ventana esté tapada, porque enfocar la ventana al
			// aparecer una unidad es justamente lo que se quiere en ese caso.
			// Se guarda la promesa, no sólo el resultado.
			//
			// `listen` es asíncrono: si el último suscriptor se desmonta antes de
			// que resuelva, `onUnmounted` no encontraba nada que cancelar y el
			// oyente quedaba registrado para toda la vida del proceso. Al volver
			// a montar se registraba otro, y cada aviso disparaba dos consultas.
			listenPromise = listen(MOUNTS_CHANGED_EVENT, () => {
				void fetchDrives();
			});
			void listenPromise.then((unlisten) => {
				unlistenMounts = unlisten;
			});
			watchVisibility();
			startPolling();
		}
	});

	onUnmounted(() => {
		activeSubscribers--;

		if (activeSubscribers === 0) {
			stopPolling();
			unwatchVisibility();
			// Si `listen` todavía no resolvió, se cancela cuando resuelva.
			const pendiente = listenPromise;
			listenPromise = null;
			if (unlistenMounts) {
				unlistenMounts();
				unlistenMounts = null;
			} else if (pendiente) {
				void pendiente.then((unlisten) => {
					unlisten();
					unlistenMounts = null;
				});
			}
		}
	});

	return {
		drives,
		isLoading,
		error,
		fetchDrives,
		refresh,
		getDriveByPath,
	};
}

export { drives as sharedDrives, getDriveByPath };
