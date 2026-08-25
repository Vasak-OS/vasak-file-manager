import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMounted, onUnmounted, ref } from 'vue';
import type { DriveInfo } from '@/types/drive-info';

const DRIVE_POLL_INTERVAL_MS = 5000;

const drives = ref<DriveInfo[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let onVisibilityChange: (() => void) | null = null;
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
 * Lo correcto de verdad sería no preguntar nunca y escuchar: udisks2 emite
 * señales de D-Bus al aparecer un dispositivo, y `/proc/self/mountinfo` avisa
 * con `POLLPRI` al cambiar la tabla de montajes. Se dejó para cuando se pueda
 * probar con un dispositivo real: un vigilante que no dispare deja las unidades
 * sin refrescar nunca, y eso es peor que sondear.
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
			watchVisibility();
			startPolling();
		}
	});

	onUnmounted(() => {
		activeSubscribers--;

		if (activeSubscribers === 0) {
			stopPolling();
			unwatchVisibility();
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
