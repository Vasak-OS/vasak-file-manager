/**
 * La búsqueda global, que ahora sólo **lee** un índice que mantiene otro.
 *
 * Hasta la 0.21 esta aplicación escaneaba el disco y escribía el índice: tenía
 * su propio recorrido, detección de inactividad para rehacerlo sola, barra de
 * progreso, cancelación y una lista de unidades que recorrer. Todo eso se fue a
 * `vasak-prism`, que es el que vive prendido —el gestor se abre y se cierra— y
 * por lo tanto el único que puede mantener el índice al día sin que nadie pida
 * nada. Ver Vasak-OS/vasak-file-manager#75 y Vasak-OS/vasak-prism#33.
 *
 * Lo que queda es consultar, y se hace **abriendo el mismo índice de sólo
 * lectura** en vez de preguntarle al lanzador por D-Bus. Fue deliberado: así la
 * búsqueda anda aunque el daemon no esté corriendo, y las dos aplicaciones no
 * quedan atadas a que la otra esté viva.
 */
import { invoke } from '@tauri-apps/api/core';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { SEARCH_CONSTANTS } from '@/constants/search';
import { indiceEstaIncompleto } from '@/stores/runtime/global-search-estado';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useUserStatsStore } from '@/stores/storage/user-stats';
import type { DirEntry } from '@/types/dir-entry';
import { debeRetomarSondeo, debeSeguirSondeando, intervaloDeSondeo } from './global-search-polling';

type GlobalSearchStatus = {
	/**
	 * Si hay un escaneo corriendo, **según el archivo de estado del lanzador**.
	 *
	 * No lo sabe este proceso: lo lee de un archivo que escribe otro. Por eso no
	 * hay progreso ni unidad actual ni forma de cancelarlo — para eso habría que
	 * preguntarle al lanzador, que es el acoplamiento que se decidió no tener.
	 */
	is_scan_in_progress: boolean;
	last_scan_time: number | null;
	indexed_item_count: number;
	index_size_bytes: number;
	is_index_valid: boolean;
	last_scan_state: string | null;
	last_scan_is_live: boolean;
	/** Que todavía no hay índice. Normal, no es un error. */
	index_missing: boolean;
	/** Por qué no se pudo abrir el índice **estando**. Eso sí es un problema. */
	index_unavailable_reason: string | null;
};

const DEBOUNCE_DELAY_MS = 200;

/**
 * Quién puede fallar en la búsqueda global.
 *
 * Cada uno tiene su casillero de error: son operaciones distintas, fallan por
 * motivos distintos y se recuperan por separado.
 */
type OrigenDeError = 'busqueda' | 'arranque' | 'estado';

/** En qué orden se muestran cuando hay más de uno puesto. */
const ORDEN_DE_LOS_ERRORES: OrigenDeError[] = ['busqueda', 'arranque', 'estado'];

export const useGlobalSearchStore = defineStore('globalSearch', () => {
	const isOpen = ref(false);
	const query = ref('');
	const results = ref<DirEntry[]>([]);
	const isSearching = ref(false);
	const isScanInProgress = ref(false);
	const lastScanTime = ref<number | null>(null);
	const indexedItemCount = ref<number>(0);
	const indexSizeBytes = ref<number>(0);
	const isIndexValid = ref(false);
	const lastScanState = ref<string | null>(null);
	const lastScanIsLive = ref(false);
	/**
	 * Que todavía no hay índice.
	 *
	 * Es normal —`vasak-prism` no escaneó todavía, o no está instalado— y no es
	 * un error de nadie. Va aparte de `indexUnavailableReason` justamente por
	 * eso: mezclados, la primera búsqueda en una máquina recién instalada
	 * aparece con un cartel rojo por algo que no está roto.
	 */
	const indexMissing = ref(false);
	/**
	 * Por qué no se pudo abrir el índice **estando**.
	 *
	 * Esto sí es un problema —un esquema de otra versión, un directorio
	 * ilegible— y se muestra como tal, con el motivo que da el backend.
	 */
	const indexUnavailableReason = ref<string | null>(null);
	const isInitialized = ref(false);
	/**
	 * Lo último que falló, **por origen**.
	 *
	 * Era una sola ranura, y eso hacía que cada operación que salía bien borrara
	 * el error de otra que seguía siendo cierta. El caso que lo destapó:
	 * enumerar las raíces falla y lo anota; medio segundo después el sondeo de
	 * estado contesta bien y pone la ranura en nulo. El motivo por el que no hay
	 * nada que buscar desaparece del cartel y queda sólo «todavía no hay nada
	 * indexado», que no explica nada.
	 *
	 * Con un casillero por origen, cada operación limpia **el suyo** al salir
	 * bien y no toca los demás.
	 */
	const errores = ref<Partial<Record<OrigenDeError, string>>>({});

	/** Anota lo que falló en el casillero de quien falló. */
	function anotarError(origen: OrigenDeError, error: unknown) {
		errores.value = { ...errores.value, [origen]: String(error) };
	}

	/** Y lo borra cuando esa misma operación vuelve a salir bien. */
	function olvidarError(origen: OrigenDeError) {
		if (errores.value[origen] === undefined) return;
		const resto = { ...errores.value };
		delete resto[origen];
		errores.value = resto;
	}

	/**
	 * El que se muestra, cuando hay más de uno.
	 *
	 * El orden es por lo que le sirve a quien mira: primero lo que rompió la
	 * búsqueda que acaba de escribir, después lo que explica que no haya índice,
	 * y al final lo de fondo. La detección de inactividad va última porque sin
	 * ella la búsqueda funciona igual —sólo deja de reindexarse sola—.
	 */
	const lastError = computed<string | null>(() => {
		for (const origen of ORDEN_DE_LOS_ERRORES) {
			const mensaje = errores.value[origen];
			if (mensaje) return mensaje;
		}
		return null;
	});
	const statusPollTimerId = ref<ReturnType<typeof setTimeout> | null>(null);
	const debounceTimerId = ref<ReturnType<typeof setTimeout> | null>(null);
	const searchAbortController = ref<AbortController | null>(null);
	//const userSettingsStore = useUserSettingsStore();
	const userStatsStore = useUserStatsStore();
	const userPathsStore = useUserPathsStore();

	const indiceIncompleto = computed(() =>
		indiceEstaIncompleto(lastScanState.value, lastScanIsLive.value, isScanInProgress.value)
	);

	function updateStatusFromResponse(status: GlobalSearchStatus) {
		isScanInProgress.value = status.is_scan_in_progress;
		lastScanTime.value = status.last_scan_time ?? null;
		indexedItemCount.value = status.indexed_item_count ?? 0;
		indexSizeBytes.value = status.index_size_bytes ?? 0;
		isIndexValid.value = status.is_index_valid ?? false;
		lastScanState.value = status.last_scan_state ?? null;
		lastScanIsLive.value = status.last_scan_is_live ?? false;
		indexMissing.value = status.index_missing ?? false;
		indexUnavailableReason.value = status.index_unavailable_reason ?? null;
	}

	async function refreshStatus() {
		try {
			const status = await invoke<GlobalSearchStatus>('global_search_get_status');
			updateStatusFromResponse(status);
			olvidarError('estado');
		} catch (error) {
			anotarError('estado', error);
		}
	}

	/**
	 * Se entera de cómo está el índice. No lo arma.
	 *
	 * Acá se decidía si había que escanear y se arrancaba el recorrido. Ya no
	 * hay nada que arrancar: el índice lo mantiene `vasak-prism`, que lo
	 * refresca cuando alguien abre el lanzador. Esta aplicación mira y consulta.
	 */
	async function initOnLaunch() {
		if (isInitialized.value) return;

		try {
			const status = await invoke<GlobalSearchStatus>('global_search_init');
			updateStatusFromResponse(status);
			olvidarError('arranque');
		} catch (error) {
			anotarError('arranque', error);
		} finally {
			// Pase lo que pase: sin esto, un fallo al preguntar dejaba a la
			// aplicación preguntando de nuevo en cada apertura del panel.
			isInitialized.value = true;
		}
	}

	async function pollStatus() {
		await refreshStatus();

		if (statusPollTimerId.value !== null) {
			clearTimeout(statusPollTimerId.value);
			statusPollTimerId.value = null;
		}

		const isActive = isScanInProgress.value;

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
		const activo = isScanInProgress.value;
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

			olvidarError('busqueda');
		} catch (error) {
			if (!searchAbortController.value?.signal.aborted) {
				anotarError('busqueda', error);
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

		const isActive = isScanInProgress.value;

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

	watch(query, () => {
		search();
	});

	return {
		isOpen,
		query,
		results,
		isSearching,
		isScanInProgress,
		lastScanTime,
		indexedItemCount,
		indexSizeBytes,
		isIndexValid,
		lastScanState,
		lastScanIsLive,
		indiceIncompleto,
		indexMissing,
		indexUnavailableReason,
		isInitialized,
		lastError,
		errores,
		open,
		close,
		toggle,
		setQuery,
		clearQuery,
		refreshStatus,
		initOnLaunch,
		startStatusPolling,
		stopStatusPolling,
		search,
	};
});
