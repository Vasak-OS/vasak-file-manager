import { invoke } from '@tauri-apps/api/core';
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { debeSondear, progresoAplicable, puedeConsultar } from '@/stores/runtime/dir-size-tracking';
import { useStatusCenterStore } from '@/stores/runtime/status-center';

export type SizeStatus = 'Complete' | 'Error' | 'Loading';

export interface DirSizeInfo {
	size: number;
	status: SizeStatus;
	fileCount: number;
	dirCount: number;
	calculatedAt: number;
}

export interface DirSizeResult {
	path: string;
	size: number;
	status: 'Complete' | 'Partial' | 'Timeout' | 'Error' | 'Cancelled';
	file_count: number;
	dir_count: number;
	error: string | null;
}

export const useDirSizesStore = defineStore('dir-sizes', () => {
	const sizes = reactive(new Map<string, DirSizeInfo>());
	const pendingPaths = ref<Set<string>>(new Set());
	/**
	 * Las rutas cuyo cálculo se está siguiendo.
	 *
	 * Antes había un `setInterval` **por ruta**, cada uno con su ida y vuelta
	 * por el IPC cada dos segundos: abrir una carpeta con veinte subcarpetas
	 * armaba veinte temporizadores y diez consultas por segundo. Ahora es un
	 * solo temporizador que pide todas juntas con `get_active_calculations`, que
	 * el backend ya exponía y sólo se usaba al recargar.
	 */
	const siguiendo = reactive(new Set<string>());
	let temporizador: ReturnType<typeof setInterval> | null = null;
	/**
	 * Si hay una consulta de progreso en vuelo.
	 *
	 * `setInterval` no espera a que termine la anterior, y el cambio de
	 * visibilidad puede lanzar otra encima. Si `get_active_calculations` tarda
	 * más de dos segundos, una respuesta vieja llega después de una nueva y pisa
	 * tamaños y conteos más recientes.
	 */
	let consultando = false;

	const pendingCount = computed(() => pendingPaths.value.size);

	function getSize(path: string): DirSizeInfo | undefined {
		return sizes.get(path);
	}

	function getSizeValue(path: string): number | null {
		const info = getSize(path);

		if (!info || info.status === 'Loading') {
			return null;
		}

		return info.size;
	}

	function getStatus(path: string): SizeStatus | undefined {
		const info = getSize(path);
		return info?.status;
	}

	function isLoading(path: string): boolean {
		return pendingPaths.value.has(path);
	}

	function setSize(path: string, result: DirSizeResult) {
		if (result.status !== 'Complete') {
			pendingPaths.value.delete(path);
			sizes.delete(path);
			return;
		}

		sizes.set(path, {
			size: result.size,
			status: 'Complete',
			fileCount: result.file_count,
			dirCount: result.dir_count,
			calculatedAt: Date.now(),
		});
		pendingPaths.value.delete(path);
	}

	function setLoading(path: string) {
		pendingPaths.value.add(path);

		const existing = sizes.get(path);

		if (!existing) {
			sizes.set(path, {
				size: 0,
				status: 'Loading',
				fileCount: 0,
				dirCount: 0,
				calculatedAt: Date.now(),
			});
		}
	}

	/** Una sola vuelta: trae el progreso de todos los cálculos en curso. */
	async function traerProgreso() {
		if (!puedeConsultar(siguiendo, document.hidden, consultando)) {
			return;
		}
		consultando = true;
		try {
			const activos = await invoke<DirSizeResult[]>('get_active_calculations');
			for (const calculo of progresoAplicable(activos, siguiendo)) {
				sizes.set(calculo.path, {
					size: calculo.size,
					status: 'Loading',
					fileCount: calculo.file_count,
					dirCount: calculo.dir_count,
					calculatedAt: Date.now(),
				});
			}
		} catch {
			// Un progreso perdido no cambia el resultado: el cálculo sigue en el
			// backend y su valor final llega por `requestSize`.
		} finally {
			consultando = false;
		}
	}

	/** Arranca o detiene el temporizador según lo que haya que seguir. */
	function acomodarTemporizador() {
		const hace_falta = debeSondear(siguiendo, document.hidden);
		if (hace_falta && temporizador === null) {
			temporizador = setInterval(() => {
				void traerProgreso();
			}, 2000);
		} else if (!hace_falta && temporizador !== null) {
			clearInterval(temporizador);
			temporizador = null;
		}
	}

	// Al tapar la ventana se detiene, y al volver se retoma con una vuelta
	// inmediata: lo que se muestre quedó viejo mientras no se veía.
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', () => {
			// Sólo se consulta si de verdad hay algo que seguir: al volver la
			// ventana sin cálculos en curso, esto era una ida y vuelta por el IPC
			// cuya respuesta se descartaba.
			void traerProgreso();
			acomodarTemporizador();
		});
	}

	function startProgressPolling(path: string) {
		siguiendo.add(path);
		acomodarTemporizador();
	}

	function stopProgressPolling(path: string) {
		siguiendo.delete(path);
		acomodarTemporizador();
	}

	async function requestSize(path: string, forceRecalculate = false): Promise<DirSizeInfo | null> {
		if (!forceRecalculate) {
			const existing = sizes.get(path);

			if (existing?.status === 'Complete') {
				return existing;
			}
		}

		if (pendingPaths.value.has(path)) {
			return null;
		}

		setLoading(path);

		try {
			const result = await invoke<DirSizeResult>('get_dir_size', {
				path,
				timeoutMs: forceRecalculate ? null : 500,
			});

			setSize(path, result);
			return getSize(path) ?? null;
		} catch (error) {
			pendingPaths.value.delete(path);
			sizes.delete(path);
			console.error('Failed to get directory size:', error);
			return null;
		}
	}

	async function requestSizeForce(path: string): Promise<DirSizeInfo | null> {
		const statusCenterStore = useStatusCenterStore();

		if (pendingPaths.value.has(path)) {
			return null;
		}

		setLoading(path);

		const operationId = `dir-size-${path}`;
		statusCenterStore.addOperation({
			id: operationId,
			type: 'dir-size',
			status: 'in-progress',
			label: 'Calculating directory size',
			path,
		});

		startProgressPolling(path);

		try {
			const result = await invoke<DirSizeResult>('get_dir_size', {
				path,
				timeoutMs: null,
			});

			stopProgressPolling(path);

			setSize(path, result);

			if (result.status === 'Cancelled') {
				statusCenterStore.completeOperation(operationId, 'cancelled');
			} else {
				statusCenterStore.completeOperation(operationId, 'completed');
			}

			return getSize(path) ?? null;
		} catch (error) {
			stopProgressPolling(path);

			pendingPaths.value.delete(path);
			sizes.delete(path);

			statusCenterStore.completeOperation(operationId, 'error', String(error));

			console.error('Failed to get directory size:', error);
			return null;
		}
	}

	async function requestSizesBatch(paths: string[]): Promise<void> {
		const pathsToFetch = paths.filter((path) => {
			const existing = sizes.get(path);
			const isPending = pendingPaths.value.has(path);
			const hasValidCache = existing?.status === 'Complete';
			return !isPending && !hasValidCache;
		});

		if (pathsToFetch.length === 0) {
			return;
		}

		for (const path of pathsToFetch) {
			setLoading(path);
		}

		try {
			const results = await invoke<DirSizeResult[]>('get_dir_sizes_batch', {
				paths: pathsToFetch,
				timeoutMs: 500,
				useCache: true,
			});

			for (const result of results) {
				setSize(result.path, result);
			}
		} catch (error) {
			for (const path of pathsToFetch) {
				pendingPaths.value.delete(path);
			}

			console.error('Failed to get directory sizes batch:', error);
		}
	}

	async function cancelSize(path: string): Promise<boolean> {
		const statusCenterStore = useStatusCenterStore();

		try {
			const cancelled = await invoke<boolean>('cancel_dir_size', { path });

			if (cancelled) {
				stopProgressPolling(path);
				pendingPaths.value.delete(path);
				sizes.delete(path);

				const operationId = `dir-size-${path}`;
				statusCenterStore.completeOperation(operationId, 'cancelled');
			}

			return cancelled;
		} catch (error) {
			console.error('Failed to cancel size calculation:', error);
			return false;
		}
	}

	function invalidate(paths: string[]) {
		for (const path of paths) {
			sizes.delete(path);
			pendingPaths.value.delete(path);
		}

		invoke('invalidate_dir_size_cache', { paths }).catch((error) => {
			console.error('Failed to invalidate cache:', error);
		});
	}

	function invalidateAll() {
		sizes.clear();
		pendingPaths.value.clear();

		invoke('clear_dir_size_cache').catch((error) => {
			console.error('Failed to clear cache:', error);
		});
	}

	function clearLocalCache() {
		sizes.clear();
		pendingPaths.value.clear();
	}

	/**
	 * Recover active calculations after frontend reload.
	 * Queries backend for any in-progress calculations and resumes tracking them.
	 */
	async function recoverActiveCalculations(): Promise<void> {
		try {
			const activeCalcs = await invoke<DirSizeResult[]>('get_active_calculations');

			if (activeCalcs.length === 0) {
				return;
			}

			const statusCenterStore = useStatusCenterStore();

			for (const calc of activeCalcs) {
				pendingPaths.value.add(calc.path);
				sizes.set(calc.path, {
					size: calc.size,
					status: 'Loading',
					fileCount: calc.file_count,
					dirCount: calc.dir_count,
					calculatedAt: Date.now(),
				});

				const operationId = `dir-size-${calc.path}`;
				statusCenterStore.addOperation({
					id: operationId,
					type: 'dir-size',
					status: 'in-progress',
					label: 'Calculating directory size',
					path: calc.path,
				});

				startProgressPolling(calc.path);
				watchCalculationCompletion(calc.path, operationId);
			}

			console.log(`Recovered ${activeCalcs.length} active calculation(s)`);
		} catch (error) {
			console.error('Failed to recover active calculations:', error);
		}
	}

	/**
	 * Watch for calculation completion by polling until the calculation
	 * is no longer in the active list.
	 */
	function watchCalculationCompletion(path: string, operationId: string) {
		const statusCenterStore = useStatusCenterStore();

		const checkInterval = setInterval(async () => {
			try {
				const progress = await invoke<DirSizeResult | null>('get_dir_size_progress', { path });

				if (progress) {
					// Still running, update the size
					sizes.set(path, {
						size: progress.size,
						status: 'Loading',
						fileCount: progress.file_count,
						dirCount: progress.dir_count,
						calculatedAt: Date.now(),
					});
				} else {
					// Calculation completed or was cancelled
					clearInterval(checkInterval);
					stopProgressPolling(path);
					pendingPaths.value.delete(path);

					// Try to get the final result from cache
					const result = await invoke<DirSizeResult>('get_dir_size', {
						path,
						timeoutMs: 100, // Quick check, should return from cache
					});

					if (result) {
						setSize(path, result);

						if (result.status === 'Cancelled') {
							statusCenterStore.completeOperation(operationId, 'cancelled');
						} else {
							statusCenterStore.completeOperation(operationId, 'completed');
						}
					}
				}
			} catch {
				// Error checking, clean up
				clearInterval(checkInterval);
				stopProgressPolling(path);
				pendingPaths.value.delete(path);
				statusCenterStore.completeOperation(operationId, 'error');
			}
		}, 2000);
	}

	return {
		sizes,
		pendingPaths,
		pendingCount,
		getSize,
		getSizeValue,
		getStatus,
		isLoading,
		requestSize,
		requestSizeForce,
		requestSizesBatch,
		cancelSize,
		invalidate,
		invalidateAll,
		clearLocalCache,
		recoverActiveCalculations,
	};
});
