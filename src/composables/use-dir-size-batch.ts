import { invoke } from '@tauri-apps/api/core';
import { computed, ref } from 'vue';
import type { ComputedRef } from 'vue';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import type { DirSizeResult } from '@/stores/runtime/dir-sizes';

export const MAX_BATCH_SIZE = 20;
export const PRIORITY_THRESHOLD = 5;
export const CANCEL_TIMEOUT_MS = 500;

export interface DirSizeBatchOptions {
	/** Check if a path is currently visible in the viewport */
	isVisible?: (path: string) => boolean;
	/** Callback when a size result is received */
	onResult?: (path: string, size: number) => void;
	/** Callback when a size calculation fails */
	onError?: (path: string, error: string) => void;
	/** Map of directory paths to their modification timestamps for cache validation */
	getTimestamp?: (path: string) => number | undefined;
}

export interface DirSizeBatchReturn {
	/** Request size calculation for paths */
	requestSizes: (paths: string[]) => void;
	/** Cancel all pending requests */
	cancelAll: () => void;
	/** Whether any calculations are in progress */
	isCalculating: ComputedRef<boolean>;
}

/**
 * Partition an array of paths into batches of max MAX_BATCH_SIZE.
 * Each batch contains at most MAX_BATCH_SIZE elements, and the union
 * of all batches equals the original set.
 */
export function partitionIntoBatches(paths: string[]): string[][] {
	const batches: string[][] = [];
	for (let i = 0; i < paths.length; i += MAX_BATCH_SIZE) {
		batches.push(paths.slice(i, i + MAX_BATCH_SIZE));
	}
	return batches;
}

/**
 * Prioritize paths: when there are more than PRIORITY_THRESHOLD pending,
 * visible directories are processed before non-visible ones.
 */
export function prioritizePaths(
	paths: string[],
	isVisible?: (path: string) => boolean,
): string[] {
	if (paths.length <= PRIORITY_THRESHOLD || !isVisible) {
		return paths;
	}

	const visible: string[] = [];
	const notVisible: string[] = [];

	for (const path of paths) {
		if (isVisible(path)) {
			visible.push(path);
		} else {
			notVisible.push(path);
		}
	}

	return [...visible, ...notVisible];
}

/**
 * Check if a path has a cached size with unchanged timestamp.
 * Returns the cached size if valid, or null if recalculation is needed.
 */
export function getCachedIfTimestampUnchanged(
	cached: { size: number; status: string; calculatedAt: number } | undefined,
	currentTimestamp?: number,
): number | null {
	if (cached?.status !== 'Complete') {
		return null;
	}

	// If no current timestamp provided, we can't verify — assume cache is valid
	if (currentTimestamp === undefined || currentTimestamp === 0) {
		return cached.size;
	}

	// Cache is valid if the calculation happened after the directory's last modification
	if (cached.calculatedAt >= currentTimestamp) {
		return cached.size;
	}

	return null;
}

/**
 * Composable that handles batched directory size calculations with
 * priority queue for visible directories, cancellation support,
 * and cache reuse based on timestamps.
 *
 * Validates: Requirements 4.1, 4.3, 4.4, 4.5
 */
export function useDirSizeBatch(options: DirSizeBatchOptions = {}): DirSizeBatchReturn {
	const { isVisible, onResult, onError, getTimestamp } = options;

	const dirSizesStore = useDirSizesStore();

	const pendingQueue = ref<string[]>([]);
	const activeBatches = ref<number>(0);
	let cancelled = false;

	const isCalculating = computed(() => activeBatches.value > 0 || pendingQueue.value.length > 0);

	/**
	 * Process a single batch of paths by invoking the backend
	 */
	async function processBatch(batch: string[]): Promise<void> {
		if (cancelled || batch.length === 0) return;

		activeBatches.value++;

		try {
			const results = await invoke<DirSizeResult[]>('get_dir_sizes_batch', {
				paths: batch,
				timeoutMs: 500,
				useCache: true,
			});

			if (cancelled) return;

			for (const result of results) {
				if (result.status === 'Complete') {
					dirSizesStore.sizes.set(result.path, {
						size: result.size,
						status: 'Complete',
						fileCount: result.file_count,
						dirCount: result.dir_count,
						calculatedAt: Date.now(),
					});
					dirSizesStore.pendingPaths.delete(result.path);
					onResult?.(result.path, result.size);
				} else if (result.status === 'Error') {
					dirSizesStore.pendingPaths.delete(result.path);
					dirSizesStore.sizes.set(result.path, {
						size: 0,
						status: 'Error',
						fileCount: 0,
						dirCount: 0,
						calculatedAt: Date.now(),
						error: result.error ?? 'Unknown error',
					});
					onError?.(result.path, result.error ?? 'Unknown error');
				} else if (result.status === 'Timeout') {
					dirSizesStore.pendingPaths.delete(result.path);
					dirSizesStore.sizes.set(result.path, {
						size: result.size,
						status: 'Timeout',
						fileCount: result.file_count,
						dirCount: result.dir_count,
						calculatedAt: Date.now(),
					});
					onError?.(result.path, 'Timeout');
				}
			}
		} catch (error) {
			if (cancelled) return;

			// Error isolation: report individual path errors without stopping other batches
			for (const path of batch) {
				dirSizesStore.pendingPaths.delete(path);
				dirSizesStore.sizes.set(path, {
					size: 0,
					status: 'Error',
					fileCount: 0,
					dirCount: 0,
					calculatedAt: Date.now(),
					error: error instanceof Error ? error.message : String(error),
				});
				onError?.(path, error instanceof Error ? error.message : String(error));
			}
		} finally {
			activeBatches.value--;
		}
	}

	/**
	 * Process the pending queue sequentially by batch, respecting priority
	 */
	async function processQueue(): Promise<void> {
		while (pendingQueue.value.length > 0 && !cancelled) {
			// Re-prioritize on each iteration (visibility may change)
			const prioritized = prioritizePaths([...pendingQueue.value], isVisible);
			pendingQueue.value = [];

			const batches = partitionIntoBatches(prioritized);

			for (const batch of batches) {
				if (cancelled) break;
				await processBatch(batch);
			}
		}
	}

	/**
	 * Request size calculation for a set of directory paths.
	 * Paths are partitioned into batches, prioritized by visibility,
	 * and cached results are reused when timestamps haven't changed.
	 */
	function requestSizes(paths: string[]): void {
		if (paths.length === 0) return;

		cancelled = false;

		// Filter out already-pending and already-cached paths (cache reuse by timestamp)
		const pathsToProcess = paths.filter((path) => {
			if (dirSizesStore.pendingPaths.has(path)) return false;

			// Check cache validity: reuse if timestamp hasn't changed (Requirement 4.4)
			const cached = dirSizesStore.getSize(path);
			if (cached) {
				const currentTimestamp = getTimestamp?.(path);
				const cachedSize = getCachedIfTimestampUnchanged(cached, currentTimestamp);
				if (cachedSize !== null) {
					onResult?.(path, cachedSize);
					return false;
				}
			}

			return true;
		});

		if (pathsToProcess.length === 0) return;

		// Mark all as loading in the store
		for (const path of pathsToProcess) {
			dirSizesStore.pendingPaths.add(path);
			if (!dirSizesStore.sizes.has(path)) {
				dirSizesStore.sizes.set(path, {
					size: 0,
					status: 'Loading',
					fileCount: 0,
					dirCount: 0,
					calculatedAt: Date.now(),
				});
			}
		}

		// Add to pending queue
		pendingQueue.value.push(...pathsToProcess);

		// Start processing if not already running
		if (activeBatches.value === 0) {
			processQueue();
		}
	}

	/**
	 * Cancel all pending requests within 500ms.
	 * Active in-flight requests will complete but their results
	 * won't trigger callbacks.
	 */
	function cancelAll(): void {
		cancelled = true;

		// Clear the pending queue immediately
		const pathsToCancel = [...pendingQueue.value];
		pendingQueue.value = [];

		// Clean up store state for cancelled paths
		for (const path of pathsToCancel) {
			dirSizesStore.pendingPaths.delete(path);
			dirSizesStore.sizes.delete(path);
		}

		// Reset cancelled flag after timeout to allow new requests
		setTimeout(() => {
			cancelled = false;
		}, CANCEL_TIMEOUT_MS);
	}

	return {
		requestSizes,
		cancelAll,
		isCalculating,
	};
}
