import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { onUnmounted } from 'vue';
import { createBatchAccumulator } from '@/utils/event-throttle';

/**
 * Payload emitted by the Tauri backend when a watched directory changes.
 */
export interface DirChangePayload {
	watchedPath: string;
	changedPath: string;
	kind: string;
}

/** Configuration for the watcher batch accumulator */
const WATCHER_BATCH_INTERVAL = 500;
const WATCHER_MAX_BATCH_SIZE = 200;

interface UseWatcherBatchOptions {
	/**
	 * Called with a batch of change events for the currently watched directory.
	 * The composable groups events within 500ms windows (max 200 per batch).
	 */
	onBatch: (events: DirChangePayload[]) => void;
	/**
	 * Called when a change is detected for a path other than the watched path
	 * (e.g., the current path was deleted or renamed externally).
	 */
	onExternalChange?: () => void;
	/**
	 * Returns the current path being watched to validate incoming events.
	 */
	getCurrentPath: () => string | null;
}

/**
 * Composable that wraps the Tauri file watcher with a batch accumulator.
 *
 * Groups file system change events into batches using `createBatchAccumulator`
 * with a 500ms interval and a max of 200 events per batch.
 *
 * Cancels pending batches when navigating to a different directory.
 *
 * Requirement 6.4: agrupar cambios del watcher en ventanas de 500ms, máx 200.
 * Requirement 6.5: cancelación al navegar.
 */
export function useWatcherBatch(options: UseWatcherBatchOptions) {
	let watchedPath: string | null = null;
	let dirChangeUnlisten: UnlistenFn | null = null;

	const accumulator = createBatchAccumulator<DirChangePayload>(
		(events) => {
			options.onBatch(events);
		},
		WATCHER_BATCH_INTERVAL,
		WATCHER_MAX_BATCH_SIZE
	);

	// Separate accumulator for external (validation) changes
	const validationAccumulator = createBatchAccumulator<DirChangePayload>(
		() => {
			options.onExternalChange?.();
		},
		WATCHER_BATCH_INTERVAL,
		WATCHER_MAX_BATCH_SIZE
	);

	/**
	 * Start watching a directory path for file system changes.
	 * If already watching the same path, this is a no-op.
	 * If watching a different path, stops the previous watch first and
	 * cancels any pending batched events.
	 */
	async function startWatching(path: string): Promise<void> {
		const normalizedPath = path.endsWith('/') ? path : `${path}/`;

		if (watchedPath === normalizedPath) {
			return;
		}

		await stopWatching();

		try {
			await invoke('watch_directory', { path: normalizedPath });
			watchedPath = normalizedPath;

			if (!dirChangeUnlisten) {
				dirChangeUnlisten = await listen<DirChangePayload>('dir-change', (event) => {
					const currentPath = options.getCurrentPath();

					if (event.payload.watchedPath === watchedPath) {
						// Event belongs to the currently watched directory — accumulate it
						accumulator.push(event.payload);
					} else if (currentPath) {
						// Event for a different path — accumulate for validation
						validationAccumulator.push(event.payload);
					}
				});
			}
		} catch (err) {
			console.error('Failed to start directory watcher:', err);
		}
	}

	/**
	 * Stop watching the current directory.
	 * Cancels any pending batched events from the accumulator.
	 */
	async function stopWatching(): Promise<void> {
		// Cancel pending batched events (Requirement 6.5)
		accumulator.cancel();
		validationAccumulator.cancel();

		if (watchedPath) {
			try {
				await invoke('unwatch_directory', { path: watchedPath });
			} catch (err) {
				console.error('Failed to stop directory watcher:', err);
			}

			watchedPath = null;
		}
	}

	/**
	 * Cancel all pending batched events without stopping the watcher.
	 * Useful when navigating to a different directory before the new watcher is set up.
	 */
	function cancelPending(): void {
		accumulator.cancel();
		validationAccumulator.cancel();
	}

	/**
	 * Get the currently watched path.
	 */
	function getWatchedPath(): string | null {
		return watchedPath;
	}

	onUnmounted(() => {
		stopWatching();

		if (dirChangeUnlisten) {
			dirChangeUnlisten();
			dirChangeUnlisten = null;
		}
	});

	return {
		startWatching,
		stopWatching,
		cancelPending,
		getWatchedPath,
	};
}
