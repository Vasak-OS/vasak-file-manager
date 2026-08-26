import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { sharedDrives } from '@/composables/use-drives';
import { SEARCH_CONSTANTS } from '@/constants/search';
import { useUserPathsStore } from '@/stores/storage/user-paths';
//import { useUserSettingsStore } from '@/stores/storage/user-settings';
import { useUserStatsStore } from '@/stores/storage/user-stats';
import type { DirEntry } from '@/types/dir-entry';
import { debeRetomarSondeo, debeSeguirSondeando, intervaloDeSondeo } from './global-search-polling';
import {
	debeEscanearAlArrancar,
	debeReindexar,
	type EstadoDeInactividadDelSistema,
	leerSenal,
	RED_DE_SEGURIDAD_MS,
	type SenalDeInactividad,
} from './idle-reindex';

type GlobalSearchDriveScanError = {
	drive_root: string;
	message: string;
};

type GlobalSearchStatus = {
	is_scan_in_progress: boolean;
	is_committing: boolean;
	is_parallel_scan: boolean;
	last_scan_time: number | null;
	indexed_item_count: number;
	index_size_bytes: number;
	current_drive_root: string | null;
	drive_scan_errors: GlobalSearchDriveScanError[];
	is_index_valid: boolean;
	scanned_drives_count: number;
	total_drives_count: number;
};

const DEBOUNCE_DELAY_MS = 200;

/**
 * Donde el backend avisa que la sesión quedó sin nadie, o que volvió a haberlo.
 *
 * El umbral —cuánto silencio hace falta— lo aplica el compositor y viaja en el
 * propio estado, así que no se repite acá. Ver `idle_monitor` en el backend.
 */
const EVENTO_INACTIVIDAD = 'idle://changed';

export const useGlobalSearchStore = defineStore('globalSearch', () => {
	const isOpen = ref(false);
	const query = ref('');
	const results = ref<DirEntry[]>([]);
	const isSearching = ref(false);
	const isScanInProgress = ref(false);
	const isCommitting = ref(false);
	const isParallelScan = ref(false);
	const lastScanTime = ref<number | null>(null);
	const indexedItemCount = ref<number>(0);
	const indexSizeBytes = ref<number>(0);
	const currentDriveRoot = ref<string | null>(null);
	const driveScanErrors = ref<GlobalSearchDriveScanError[]>([]);
	const isIndexValid = ref(false);
	const scannedDrivesCount = ref(0);
	const totalDrivesCount = ref(0);
	const isInitialized = ref(false);
	const lastError = ref<string | null>(null);

	const statusPollTimerId = ref<ReturnType<typeof setTimeout> | null>(null);
	const debounceTimerId = ref<ReturnType<typeof setTimeout> | null>(null);
	const searchAbortController = ref<AbortController | null>(null);
	const redDeSeguridadId = ref<ReturnType<typeof setInterval> | null>(null);
	const driveChangeDebounceTimerId = ref<ReturnType<typeof setTimeout> | null>(null);
	const senalDeInactividad = ref<SenalDeInactividad>('desconocida');
	const dejarDeEscucharInactividad = ref<UnlistenFn | null>(null);
	const lastKnownDriveCount = ref<number>(0);

	//const userSettingsStore = useUserSettingsStore();
	const userStatsStore = useUserStatsStore();
	const userPathsStore = useUserPathsStore();

	const scanProgress = computed(() => {
		if (totalDrivesCount.value === 0) return 0;
		return Math.round((scannedDrivesCount.value / totalDrivesCount.value) * 100);
	});

	const needsScan = computed(() => {
		if (isScanInProgress.value) return false;
		if (!isIndexValid.value) return true;
		if (indexedItemCount.value === 0) return true;
		return false;
	});

	function getIsIndexStale() {
		if (!lastScanTime.value) return true;
		if (!isIndexValid.value) return true;
		if (indexedItemCount.value === 0) return true;

		// const settings = userSettingsStore.userSettings.globalSearch;
		const staleThresholdMs = 30 * 60 * 1000;
		const timeSinceLastScan = Date.now() - lastScanTime.value;

		return timeSinceLastScan > staleThresholdMs;
	}

	/**
	 * Si la sesión está inactiva según el sistema.
	 *
	 * «Según el sistema» es lo que cambió: antes se miraba la actividad sobre
	 * esta ventana, que con la ventana tapada no existe.
	 */
	function getIsUserIdle() {
		return senalDeInactividad.value === 'inactiva';
	}

	async function getDriveRoots(): Promise<string[]> {
		// const selected = userSettingsStore.userSettings.globalSearch.selectedDriveRoots;
		// if (selected.length > 0) return selected;

		try {
			const systemDrives = await invoke<Array<{ path: string }>>('get_system_drives');
			return systemDrives.map((drive) => drive.path);
		} catch (error) {
			lastError.value = String(error);
			return [];
		}
	}

	function updateStatusFromResponse(status: GlobalSearchStatus) {
		isScanInProgress.value = status.is_scan_in_progress;
		isCommitting.value = status.is_committing ?? false;
		isParallelScan.value = status.is_parallel_scan ?? false;
		lastScanTime.value = status.last_scan_time ?? null;
		indexedItemCount.value = status.indexed_item_count ?? 0;
		indexSizeBytes.value = status.index_size_bytes ?? 0;
		currentDriveRoot.value = status.current_drive_root ?? null;
		driveScanErrors.value = Array.isArray(status.drive_scan_errors) ? status.drive_scan_errors : [];
		isIndexValid.value = status.is_index_valid ?? false;
		scannedDrivesCount.value = status.scanned_drives_count ?? 0;
		totalDrivesCount.value = status.total_drives_count ?? 0;
	}

	async function refreshStatus() {
		try {
			const status = await invoke<GlobalSearchStatus>('global_search_get_status');
			updateStatusFromResponse(status);
			lastError.value = null;
		} catch (error) {
			lastError.value = String(error);
		}
	}

	async function initOnLaunch() {
		if (isInitialized.value) return;

		try {
			const status = await invoke<GlobalSearchStatus>('global_search_init');
			updateStatusFromResponse(status);
			isInitialized.value = true;
			lastError.value = null;

			lastKnownDriveCount.value = sharedDrives.value.length;

			await startIdleDetection();

			// Sin índice se escanea ya; vencido, espera a que la sesión esté
			// inactiva. Ver `debeEscanearAlArrancar`.
			if (debeEscanearAlArrancar(needsScan.value)) {
				await startScan();
			}
		} catch (error) {
			lastError.value = String(error);
			isInitialized.value = true;
			await startIdleDetection();
		}
	}

	async function pollStatus() {
		await refreshStatus();

		if (statusPollTimerId.value !== null) {
			clearTimeout(statusPollTimerId.value);
			statusPollTimerId.value = null;
		}

		const isActive = isScanInProgress.value || isCommitting.value;

		// Se reagenda sólo si queda algo que mirar. Antes se reagendaba siempre,
		// y como el único que lo detenía era cerrar el panel, el caso normal
		// —escaneo automático al abrir la aplicación, panel nunca abierto— dejaba
		// un IPC cada cinco segundos hasta que se cerrara el gestor.
		if (!debeSeguirSondeando(isActive, isOpen.value, estaOculto())) {
			return;
		}

		statusPollTimerId.value = setTimeout(() => pollStatus(), intervaloDeSondeo(isActive));
	}

	/** Si la ventana no está a la vista de nadie. */
	function estaOculto(): boolean {
		return typeof document !== 'undefined' && document.hidden;
	}

	/**
	 * Retoma el sondeo al volver la ventana, si hay a quién informarle.
	 *
	 * Sin esto, un panel abierto en una ventana que se tapa deja de sondear y no
	 * vuelve a empezar: se quedaría mostrando el estado de cuando se ocultó.
	 *
	 * Se registra al abrir el panel y se saca al cerrarlo, que es el ciclo de
	 * vida del que depende. Antes vivía dentro de `startIdleDetection`, colgado
	 * de la detección de inactividad: dos cosas que no tienen nada que ver, y
	 * como a `startIdleDetection` sólo la llama `initOnLaunch` —que hoy no llama
	 * nadie—, el escucha no llegaba a registrarse nunca.
	 */
	function alCambiarVisibilidad() {
		if (debeRetomarSondeo(estaOculto(), isOpen.value)) {
			startStatusPolling();
			return;
		}

		// Y al ocultarse, cortar el temporizador que ya está agendado. Sin esto la
		// pausa no era inmediata: quedaba una consulta pendiente que igual salía
		// —con su IPC— antes de que la guarda de `pollStatus` dejara de
		// reagendar. Con un escaneo en curso no se corta nada, porque ahí el
		// sondeo tiene que seguir aunque nadie mire.
		const activo = isScanInProgress.value || isCommitting.value;
		if (!debeSeguirSondeando(activo, isOpen.value, estaOculto())) {
			stopStatusPolling();
		}
	}

	function startStatusPolling() {
		if (statusPollTimerId.value !== null) return;
		pollStatus();
	}

	function stopStatusPolling() {
		if (statusPollTimerId.value === null) return;
		clearTimeout(statusPollTimerId.value);
		statusPollTimerId.value = null;
	}

	async function startScan() {
		if (isScanInProgress.value) return;

		try {
			// const settings = userSettingsStore.userSettings.globalSearch;
			const driveRoots = await getDriveRoots();

			if (driveRoots.length === 0) {
				lastError.value = 'No drives available for scanning';
				return;
			}

			startStatusPolling();

			await invoke('global_search_start_scan', {
				settings: {
					scan_depth: Math.max(1, /*Math.floor(settings.scanDepth)*/ 5),
					ignored_paths: /*settings.ignoredPaths*/ [],
					drive_roots: driveRoots,
					parallel_scan: /* settings.parallelScan ??*/ false,
				},
			});

			await refreshStatus();
			lastError.value = null;
		} catch (error) {
			lastError.value = String(error);
			isScanInProgress.value = false;
		}
	}

	async function cancelScan() {
		if (!isScanInProgress.value) return;

		try {
			await invoke('global_search_cancel_scan');

			const maxWaitMs = 5000;
			const pollIntervalMs = 100;
			let waited = 0;

			while (waited < maxWaitMs) {
				await refreshStatus();

				if (!isScanInProgress.value) {
					break;
				}

				await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
				waited += pollIntervalMs;
			}
		} catch (error) {
			lastError.value = String(error);
		}
	}

	function cancelPendingSearch() {
		if (debounceTimerId.value) {
			clearTimeout(debounceTimerId.value);
			debounceTimerId.value = null;
		}

		if (searchAbortController.value) {
			searchAbortController.value.abort();
			searchAbortController.value = null;
		}
	}

	async function executeSearch(searchQuery: string) {
		if (!searchQuery.trim()) {
			results.value = [];
			return;
		}

		searchAbortController.value = new AbortController();
		isSearching.value = true;

		try {
			// const settings = userSettingsStore.userSettings.globalSearch;
			const queryOptions = {
				limit: /*settings.resultLimit ??*/ SEARCH_CONSTANTS.DEFAULT_RESULT_LIMIT,
				include_files: true,
				include_directories: true,
				exact_match: /*settings.exactMatch ??*/ false,
				typo_tolerance: /*settings.typoTolerance ??*/ true,
				min_score_threshold: null,
			};

			const priorityPaths = getAllPriorityPaths();

			const searchPromises: Promise<Array<DirEntry & { score?: number }>>[] = [];

			if (indexedItemCount.value > 0) {
				searchPromises.push(
					invoke<Array<DirEntry & { score?: number }>>('global_search_query', {
						query: searchQuery.trim(),
						options: queryOptions,
					})
				);
			} else {
				searchPromises.push(Promise.resolve([]));
			}

			if (priorityPaths.length > 0) {
				searchPromises.push(
					invoke<Array<DirEntry & { score?: number }>>('global_search_query_paths', {
						paths: priorityPaths,
						query: searchQuery.trim(),
						options: queryOptions,
					})
				);
			} else {
				searchPromises.push(Promise.resolve([]));
			}

			const [indexedResults, priorityResults] = await Promise.all(searchPromises);

			if (searchAbortController.value?.signal.aborted) {
				return;
			}

			const mergedResults = mergeAndDeduplicateResults(indexedResults, priorityResults);

			results.value = mergedResults.map((item) => ({
				name: item.name,
				ext: item.ext ?? null,
				path: item.path,
				size: item.size ?? 0,
				item_count: item.item_count ?? null,
				modified_time: item.modified_time ?? 0,
				accessed_time: item.accessed_time ?? 0,
				created_time: item.created_time ?? 0,
				mime: item.mime ?? null,
				is_file: Boolean(item.is_file),
				is_dir: Boolean(item.is_dir),
				is_symlink: Boolean(item.is_symlink),
				is_hidden: Boolean(item.is_hidden),
			}));

			lastError.value = null;
		} catch (error) {
			if (!searchAbortController.value?.signal.aborted) {
				lastError.value = String(error);
				results.value = [];
			}
		} finally {
			isSearching.value = false;
			searchAbortController.value = null;
		}
	}

	function mergeAndDeduplicateResults(
		indexedResults: Array<DirEntry & { score?: number }>,
		priorityResults: Array<DirEntry & { score?: number }>
	): Array<DirEntry & { score?: number }> {
		const seenPaths = new Map<string, DirEntry & { score?: number }>();

		for (const item of priorityResults) {
			const normalizedPath = item.path.toLowerCase();
			seenPaths.set(normalizedPath, item);
		}

		for (const item of indexedResults) {
			const normalizedPath = item.path.toLowerCase();

			if (!seenPaths.has(normalizedPath)) {
				seenPaths.set(normalizedPath, item);
			}
		}

		const merged = Array.from(seenPaths.values());

		merged.sort((itemA, itemB) => {
			const scoreA = itemA.score ?? 0;
			const scoreB = itemB.score ?? 0;
			return scoreB - scoreA;
		});

		return merged;
	}

	function search() {
		cancelPendingSearch();

		debounceTimerId.value = setTimeout(() => {
			executeSearch(query.value);
		}, DEBOUNCE_DELAY_MS);
	}

	async function open() {
		isOpen.value = true;
		// Registrar dos veces el mismo manejador no agrega un segundo escucha,
		// así que abrir el panel estando abierto no duplica nada.
		document.addEventListener('visibilitychange', alCambiarVisibilidad);
		await refreshStatus();
		startStatusPolling();
	}

	function close() {
		isOpen.value = false;
		document.removeEventListener('visibilitychange', alCambiarVisibilidad);
		cancelPendingSearch();

		const isActive = isScanInProgress.value || isCommitting.value;

		if (!isActive) {
			stopStatusPolling();
		}
	}

	function toggle() {
		if (isOpen.value) {
			close();
		} else {
			open();
		}
	}

	function setQuery(value: string) {
		query.value = value;
	}

	function clearQuery() {
		cancelPendingSearch();
		query.value = '';
		results.value = [];
	}

	function checkIdleReindex() {
		//const settings = userSettingsStore.userSettings.globalSearch;

		// if (!settings.autoReindexWhenIdle) return;
		const corresponde = debeReindexar({
			senal: senalDeInactividad.value,
			escaneoEnCurso: isScanInProgress.value,
			inicializado: isInitialized.value,
			indiceVencido: getIsIndexStale(),
		});

		if (!corresponde) return;

		startScan();
	}

	function getAllPriorityPaths(): string[] {
		const paths = new Set<string>();

		const userDirs = [
			userPathsStore.userPaths.downloadDir,
			userPathsStore.userPaths.documentDir,
			userPathsStore.userPaths.desktopDir,
			userPathsStore.userPaths.pictureDir,
			userPathsStore.userPaths.videoDir,
			userPathsStore.userPaths.audioDir,
		].filter(Boolean);

		for (const dirPath of userDirs) {
			paths.add(dirPath);
		}

		for (const favorite of userStatsStore.favorites) {
			if (favorite.path) paths.add(favorite.path);
		}

		for (const historyItem of userStatsStore.history) {
			if (historyItem.path) paths.add(historyItem.path);
		}

		for (const frequentItem of userStatsStore.frequentItems) {
			if (frequentItem.path) paths.add(frequentItem.path);
		}

		for (const taggedItem of userStatsStore.taggedItems) {
			if (taggedItem.path) paths.add(taggedItem.path);
		}

		return Array.from(paths);
	}

	/**
	 * Aplica lo que informó el sistema.
	 *
	 * Al pasar a inactiva se revisa en el acto —ese es el momento exacto en que
	 * se abrió la ventana de oportunidad— y se deja la red de seguridad
	 * corriendo. Al salir de inactiva se apaga: un temporizador despertando para
	 * siempre mientras alguien usa la máquina es lo contrario de lo que se
	 * busca.
	 */
	function aplicarEstadoDeInactividad(estado: EstadoDeInactividadDelSistema | null) {
		senalDeInactividad.value = leerSenal(estado);

		if (senalDeInactividad.value === 'inactiva') {
			iniciarRedDeSeguridad();
			checkIdleReindex();
			return;
		}

		detenerRedDeSeguridad();
	}

	function iniciarRedDeSeguridad() {
		if (redDeSeguridadId.value !== null) return;
		redDeSeguridadId.value = setInterval(checkIdleReindex, RED_DE_SEGURIDAD_MS);
	}

	function detenerRedDeSeguridad() {
		if (redDeSeguridadId.value === null) return;
		clearInterval(redDeSeguridadId.value);
		redDeSeguridadId.value = null;
	}

	/**
	 * Se pone a escuchar al sistema en vez de a la propia ventana.
	 *
	 * El backend avisa las transiciones, pero cuando esto arranca la sesión ya
	 * puede llevar un rato inactiva —o el aviso de que hay señal ya puede haber
	 * pasado—, así que además se pregunta una vez el estado actual.
	 */
	async function startIdleDetection() {
		if (dejarDeEscucharInactividad.value !== null) return;

		dejarDeEscucharInactividad.value = await listen<EstadoDeInactividadDelSistema>(
			EVENTO_INACTIVIDAD,
			(evento) => aplicarEstadoDeInactividad(evento.payload)
		);

		try {
			aplicarEstadoDeInactividad(await invoke<EstadoDeInactividadDelSistema>('system_idle_state'));
		} catch (error) {
			// Sin backend que conteste no hay señal, y sin señal no se reindexa
			// solo. Se anota el error pero no se cae nada: la búsqueda sigue
			// funcionando, y el escaneo manual también.
			lastError.value = String(error);
			aplicarEstadoDeInactividad(null);
		}
	}

	function stopIdleDetection() {
		detenerRedDeSeguridad();

		if (dejarDeEscucharInactividad.value !== null) {
			dejarDeEscucharInactividad.value();
			dejarDeEscucharInactividad.value = null;
		}

		senalDeInactividad.value = 'desconocida';
	}

	async function handleDriveListChange() {
		if (!isInitialized.value) return;

		const currentCount = sharedDrives.value.length;

		if (lastKnownDriveCount.value === 0) {
			lastKnownDriveCount.value = currentCount;
			return;
		}

		if (currentCount !== lastKnownDriveCount.value) {
			lastKnownDriveCount.value = currentCount;

			if (driveChangeDebounceTimerId.value !== null) {
				clearTimeout(driveChangeDebounceTimerId.value);
			}

			if (isScanInProgress.value) {
				await cancelScan();
			}

			driveChangeDebounceTimerId.value = setTimeout(() => {
				driveChangeDebounceTimerId.value = null;
				startScanWithCurrentDrives();
			}, 2000);
		}
	}

	async function startScanWithCurrentDrives() {
		if (!isInitialized.value) return;

		// const settings = userSettingsStore.userSettings.globalSearch;
		// const selectedRoots = settings.selectedDriveRoots;
		let driveRoots: string[];

		// if (selectedRoots.length > 0) {
		// 	driveRoots = selectedRoots.filter((root) =>
		// 		sharedDrives.value.some((drive) => drive.path === root)
		// 	);
		// } else {
		driveRoots = sharedDrives.value.map((drive) => drive.path);
		//}

		if (driveRoots.length === 0) {
			return;
		}

		try {
			await invoke('global_search_start_scan', {
				settings: {
					scan_depth: Math.max(1, /*Math.floor(settings.scanDepth)*/ 5),
					ignored_paths: /*settings.ignoredPaths*/ [],
					drive_roots: driveRoots,
					parallel_scan: /*settings.parallelScan ??*/ false,
				},
			});

			startStatusPolling();
		} catch (error) {
			lastError.value = String(error);
		}
	}

	watch(query, () => {
		search();
	});

	watch(
		sharedDrives,
		() => {
			handleDriveListChange();
		},
		{ deep: true }
	);

	return {
		isOpen,
		query,
		results,
		isSearching,
		isScanInProgress,
		isCommitting,
		isParallelScan,
		lastScanTime,
		indexedItemCount,
		indexSizeBytes,
		currentDriveRoot,
		driveScanErrors,
		isIndexValid,
		scannedDrivesCount,
		totalDrivesCount,
		scanProgress,
		needsScan,
		getIsIndexStale,
		isInitialized,
		lastError,
		senalDeInactividad,
		getIsUserIdle,
		open,
		close,
		toggle,
		setQuery,
		clearQuery,
		refreshStatus,
		initOnLaunch,
		startStatusPolling,
		stopStatusPolling,
		startScan,
		cancelScan,
		search,
		startIdleDetection,
		stopIdleDetection,
	};
});
