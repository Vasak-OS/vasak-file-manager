import { invoke } from '@tauri-apps/api/core';
import { basename, homeDir } from '@tauri-apps/api/path';
import { openPath } from '@tauri-apps/plugin-opener';
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useWatcherBatch } from '@/composables/use-watcher-batch';
import { useDirSizeBatch } from '@/composables/use-dir-size-batch';
import { useDirectoryCacheStore } from '@/stores/runtime/directory-cache';
import { useUserStatsStore } from '@/stores/storage/user-stats';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { DirContents, DirEntry } from '@/types/dir-entry';
import type { Tab } from '@/types/workspaces';
import { computeDiff } from '@/utils/directory-diff';
import { replacePathPrefix } from '@/utils/path';

const DIRECTORY_DWELL_TIME_MS = 3000;

function getParentOfPath(path: string): string | null {
	const parts = path.split('/').filter(Boolean);
	if (parts.length <= 1) return null;
	parts.pop();
	const parent = parts.join('/');
	return parent.includes(':') ? `${parent}/` : `/${parent}`;
}

export function useFileBrowserNavigation(
	tab: () => Tab | undefined,
	onNavigationComplete?: (dirEntry: DirEntry | null) => void,
	onSelectionClear?: () => void
) {
	const workspacesStore = useWorkspacesStore();
	const userStatsStore = useUserStatsStore();
	const directoryCache = useDirectoryCacheStore();
	const currentPath = ref('');
	const dirContents = ref<DirContents | null>(null);
	const isLoading = ref(false);
	const isRefreshing = ref(false);
	const error = ref<string | null>(null);
	const history = ref<string[]>([]);
	const historyIndex = ref(-1);
	const pathInput = ref('');
	let pendingDirectoryRecordTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingDirectoryPath: string | null = null;

	// Dir size batch calculator with prioritization and cache reuse (Requirements 4.1, 4.3, 4.4, 4.5)
	const dirSizeBatch = useDirSizeBatch({
		isVisible: (path: string) => {
			// A directory is "visible" if it's in the current directory entries
			// This is a basic heuristic — downstream integration with virtual scroller
			// can provide a more precise viewport-based predicate
			const entries = dirContents.value?.entries;
			if (!entries) return false;
			return entries.some((e) => e.path === path && e.is_dir);
		},
		getTimestamp: (path: string) => {
			// Look up the modified_time from current directory entries
			const entries = dirContents.value?.entries;
			if (!entries) return undefined;
			const entry = entries.find((e) => e.path === path);
			return entry?.modified_time;
		},
	});

	// Integrate batch accumulator for watcher events (Req 6.4, 6.5)
	const watcher = useWatcherBatch({
		onBatch: () => {
			// When a batch of file system changes is received for the watched directory,
			// invalidate the cache entry and perform a silent refresh.
			if (currentPath.value) {
				directoryCache.invalidate(currentPath.value);
			}
			silentRefresh();
		},
		onExternalChange: () => {
			// When changes occur outside the watched path, validate the current path
			// still exists (e.g., a parent directory was deleted/renamed).
			validateCurrentPath();
		},
		getCurrentPath: () => currentPath.value || null,
	});

	function cancelPendingDirectoryRecord() {
		if (pendingDirectoryRecordTimer) {
			clearTimeout(pendingDirectoryRecordTimer);
			pendingDirectoryRecordTimer = null;
			pendingDirectoryPath = null;
		}
	}

	function schedulePendingDirectoryRecord(path: string) {
		cancelPendingDirectoryRecord();
		pendingDirectoryPath = path;
		pendingDirectoryRecordTimer = setTimeout(() => {
			if (pendingDirectoryPath === path) {
				userStatsStore.recordItemOpen(path, false);
			}

			pendingDirectoryRecordTimer = null;
			pendingDirectoryPath = null;
		}, DIRECTORY_DWELL_TIME_MS);
	}

	onUnmounted(() => {
		cancelPendingDirectoryRecord();
	});

	const canGoBack = computed(() => historyIndex.value > 0);
	const canGoForward = computed(() => historyIndex.value < history.value.length - 1);

	/**
	 * Perform a background verification of cached data against the backend.
	 * If the backend returns different data, apply a minimal diff update.
	 * (Requirement 3.2: verificación en segundo plano)
	 * (Requirement 3.6, 5.4: diff mínimo)
	 */
	async function backgroundVerify(path: string): Promise<void> {
		try {
			const result = await invoke<DirContents>('read_dir', { path });

			// Only apply diff if we're still on the same path
			if (currentPath.value !== path) {
				// Still update cache even if navigated away
				directoryCache.set(path, result);
				return;
			}

			const currentEntries = dirContents.value?.entries ?? [];
			const diff = computeDiff(currentEntries, result.entries);

			const hasChanges =
				diff.added.length > 0 || diff.removed.length > 0 || diff.updated.length > 0;

			if (hasChanges) {
				// Requirement 5.4: Apply diff to cache without full replacement
				directoryCache.applyDiff(path, diff.added, diff.removed, diff.updated);

				// Get the updated cached data
				const updatedCache = directoryCache.get(path);

				if (updatedCache) {
					dirContents.value = {
						path: result.path,
						entries: updatedCache.entries,
						total_count: updatedCache.totalCount,
						dir_count: updatedCache.dirCount,
						file_count: updatedCache.fileCount,
					};
				} else {
					directoryCache.set(path, result);
					dirContents.value = result;
				}

				const currentTab = tab();
				if (currentTab) {
					currentTab.dirEntries = dirContents.value?.entries ?? result.entries;
				}
			} else {
				// No changes — just update cache timestamp
				directoryCache.set(path, result);
			}

			// Request dir sizes for any new directories
			const dirPaths = (dirContents.value?.entries ?? result.entries)
				.filter((entry) => entry.is_dir)
				.slice(0, 50)
				.map((entry) => entry.path);

			if (dirPaths.length > 0) {
				dirSizeBatch.requestSizes(dirPaths);
			}
		} catch {
			// Background verification failed silently — cached data stays
		}
	}

	async function silentRefresh(): Promise<void> {
		if (!currentPath.value) {
			return;
		}

		isRefreshing.value = true;

		try {
			const result = await invoke<DirContents>('read_dir', { path: currentPath.value });

			// Requirement 5.4: Apply minimal diff instead of replacing the entire array
			const currentEntries = dirContents.value?.entries ?? [];
			const diff = computeDiff(currentEntries, result.entries);

			const hasChanges =
				diff.added.length > 0 || diff.removed.length > 0 || diff.updated.length > 0;

			if (hasChanges) {
				// Apply diff to the cache store
				directoryCache.applyDiff(currentPath.value, diff.added, diff.removed, diff.updated);

				// Get the updated cached data to keep everything in sync
				const updatedCache = directoryCache.get(currentPath.value);

				if (updatedCache) {
					// Update dirContents with the diffed entries rather than full replacement
					dirContents.value = {
						path: result.path,
						entries: updatedCache.entries,
						total_count: updatedCache.totalCount,
						dir_count: updatedCache.dirCount,
						file_count: updatedCache.fileCount,
					};
				} else {
					// Fallback: cache might have been evicted, do full replacement
					directoryCache.set(currentPath.value, result);
					dirContents.value = result;
				}

				const currentTab = tab();
				if (currentTab) {
					currentTab.dirEntries = dirContents.value?.entries ?? result.entries;
				}
			} else {
				// No changes detected — just update cache timestamp without touching dirContents
				directoryCache.set(currentPath.value, result);
			}

			const dirPaths = (dirContents.value?.entries ?? result.entries)
				.filter((entry) => entry.is_dir)
				.slice(0, 50)
				.map((entry) => entry.path);

			if (dirPaths.length > 0) {
				dirSizeBatch.requestSizes(dirPaths);
			}
		} catch {
			await navigateToNearestExistingAncestor();
		} finally {
			isRefreshing.value = false;
		}
	}

	async function navigateToNearestExistingAncestor(): Promise<void> {
		let pathToTry = getParentOfPath(currentPath.value);

		while (pathToTry) {
			try {
				await invoke<DirContents>('read_dir', { path: pathToTry });
				await readDir(pathToTry);
				return;
			} catch {
				pathToTry = getParentOfPath(pathToTry);
			}
		}

		await navigateToHome();
	}

	async function validateCurrentPath(): Promise<void> {
		if (!currentPath.value) return;

		try {
			await invoke<DirContents>('read_dir', { path: currentPath.value });
		} catch {
			await navigateToNearestExistingAncestor();
		}
	}

	const parentPath = computed(() => {
		if (!currentPath.value) return null;
		return getParentOfPath(currentPath.value);
	});

	const currentDirEntry = computed<DirEntry | null>(() => {
		if (!dirContents.value) return null;
		const pathParts = currentPath.value.split('/').filter(Boolean);
		const name = pathParts[pathParts.length - 1] || currentPath.value;
		return {
			name,
			path: currentPath.value,
			is_dir: true,
			is_file: false,
			is_hidden: false,
			is_symlink: false,
			size: 0,
			created_time: 0,
			modified_time: 0,
			accessed_time: 0,
			item_count: dirContents.value.entries.length,
			ext: null,
			mime: null,
		};
	});

	/**
	 * Read a directory, integrating with the directory cache.
	 *
	 * Strategy:
	 * - If cached data exists, serve it immediately (<50ms) then verify in background.
	 * - If no cache, load from backend (with loading indicator).
	 * - Always store fresh results in the cache.
	 *
	 * (Requirement 3.2: servir datos cacheados en <50ms)
	 * (Requirement 3.3: invalidar al recibir evento de watcher)
	 * (Requirement 3.5: invalidar al refresco manual)
	 */
	async function readDir(path: string, addToHistory = true, forceLoading = false) {
		const normalizedPath = path.endsWith('/') ? path : `${path}/`;
		const isNewDirectory = normalizedPath !== currentPath.value;

		error.value = null;
		onSelectionClear?.();

		// Cancel pending watcher batches when navigating away
		if (isNewDirectory) {
			watcher.cancelPending();
			// Cancel pending dir size requests (Requirement 4.3: cancel within 500ms)
			dirSizeBatch.cancelAll();
		}

		// Check directory cache first (Requirement 3.2)
		const cached = directoryCache.get(normalizedPath);

		if (cached && !forceLoading) {
			// Serve cached data immediately — this should happen in <50ms
			const cachedContents: DirContents = {
				path: cached.path,
				entries: cached.entries,
				total_count: cached.totalCount,
				dir_count: cached.dirCount,
				file_count: cached.fileCount,
			};

			dirContents.value = cachedContents;
			currentPath.value = cached.path;
			pathInput.value = cached.path;
			isLoading.value = false;

			const currentTab = tab();
			if (currentTab) {
				currentTab.path = cached.path;

				try {
					currentTab.name = await basename(cached.path);
				} catch {
					currentTab.name = cached.path;
				}

				currentTab.dirEntries = cached.entries;
			}

			if (addToHistory) {
				if (historyIndex.value < history.value.length - 1) {
					history.value.splice(historyIndex.value + 1);
				}

				history.value.push(cached.path);
				historyIndex.value = history.value.length - 1;
			}

			nextTick(() => {
				onNavigationComplete?.(currentDirEntry.value);
			});

			// Request dir sizes for cached entries
			const dirPaths = cached.entries
				.filter((entry) => entry.is_dir)
				.slice(0, 50)
				.map((entry) => entry.path);

			if (dirPaths.length > 0) {
				dirSizeBatch.requestSizes(dirPaths);
			}

			// Start watcher for this directory
			await watcher.startWatching(cached.path);

			// Fire background verification to check for changes (Requirement 3.2)
			backgroundVerify(cached.path);

			return;
		}

		// No cache hit — load from backend with loading indicator
		isLoading.value = forceLoading || isNewDirectory || !dirContents.value;

		// Stop watching old directory if navigating to new one
		const currentWatched = watcher.getWatchedPath();
		if (currentWatched && currentWatched !== normalizedPath) {
			await watcher.stopWatching();
		}

		try {
			const result = await invoke<DirContents>('read_dir', { path: normalizedPath });

			// Store in cache for future navigations
			directoryCache.set(normalizedPath, result);

			dirContents.value = result;
			currentPath.value = result.path;
			pathInput.value = result.path;

			const currentTab = tab();

			if (currentTab) {
				currentTab.path = result.path;

				try {
					currentTab.name = await basename(result.path);
				} catch {
					currentTab.name = result.path;
				}

				currentTab.dirEntries = result.entries;
			}

			if (addToHistory) {
				if (historyIndex.value < history.value.length - 1) {
					history.value.splice(historyIndex.value + 1);
				}

				history.value.push(result.path);
				historyIndex.value = history.value.length - 1;
			}

			nextTick(() => {
				onNavigationComplete?.(currentDirEntry.value);
			});

			const dirPaths = result.entries
				.filter((entry) => entry.is_dir)
				.slice(0, 50)
				.map((entry) => entry.path);

			if (dirPaths.length > 0) {
				dirSizeBatch.requestSizes(dirPaths);
			}

			await watcher.startWatching(result.path);
		} catch (err: unknown) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			error.value = `${'notifications.cannotFetchDirectoryItems'}: ${errorMessage}`;
			console.error(err);
		} finally {
			isLoading.value = false;
		}
	}

	async function navigateToPath(path: string) {
		cancelPendingDirectoryRecord();
		await readDir(path);
		schedulePendingDirectoryRecord(path);
	}

	async function navigateToEntry(entry: DirEntry) {
		if (entry.is_dir) {
			cancelPendingDirectoryRecord();
			await readDir(entry.path);
			schedulePendingDirectoryRecord(entry.path);
		}
	}

	async function navigateToParent() {
		if (parentPath.value) {
			cancelPendingDirectoryRecord();
			await readDir(parentPath.value);
			schedulePendingDirectoryRecord(parentPath.value);
		}
	}

	async function navigateToHome() {
		cancelPendingDirectoryRecord();
		const homePath = await homeDir();
		await readDir(homePath);
		schedulePendingDirectoryRecord(homePath);
	}

	async function goBack() {
		if (canGoBack.value) {
			cancelPendingDirectoryRecord();
			historyIndex.value--;
			const targetPath = history.value[historyIndex.value];
			await readDir(targetPath, false);
			schedulePendingDirectoryRecord(targetPath);
		}
	}

	async function goForward() {
		if (canGoForward.value) {
			cancelPendingDirectoryRecord();
			historyIndex.value++;
			const targetPath = history.value[historyIndex.value];
			await readDir(targetPath, false);
			schedulePendingDirectoryRecord(targetPath);
		}
	}

	/**
	 * Manual refresh: invalidate cache then re-read from backend.
	 * (Requirement 3.5: invalidar al refresco manual)
	 */
	async function refresh() {
		cancelPendingDirectoryRecord();

		if (currentPath.value) {
			// Invalidate cache before forcing a fresh read
			directoryCache.invalidate(currentPath.value);
			await readDir(currentPath.value, false, true);
		}
	}

	async function handlePathSubmit() {
		if (pathInput.value && pathInput.value !== currentPath.value) {
			cancelPendingDirectoryRecord();
			await readDir(pathInput.value);
			schedulePendingDirectoryRecord(pathInput.value);
		}
	}

	async function openFile(path: string) {
		try {
			await openPath(path);
			userStatsStore.recordItemOpen(path, true);
		} catch (error) {
			console.error('Failed to open path:', error);
			// Silently fail - the file manager will display error UI if needed
		}
	}

	async function init() {
		const currentTab = tab();

		if (currentTab?.path) {
			await readDir(currentTab.path);

			if (error.value) {
				await navigateToHome();
			} else {
				schedulePendingDirectoryRecord(currentTab.path);
			}
		} else {
			await navigateToHome();
		}
	}

	watch(
		() => workspacesStore.lastRenamedPath,
		async (renamed) => {
			if (!renamed || !currentPath.value) return;

			const updatedPath = replacePathPrefix(currentPath.value, renamed.oldPath, renamed.newPath);

			if (updatedPath) {
				// Invalidate old path from cache
				directoryCache.invalidate(renamed.oldPath);

				history.value = history.value.map((historyPath) => {
					return replacePathPrefix(historyPath, renamed.oldPath, renamed.newPath) ?? historyPath;
				});

				await readDir(updatedPath, false);
			}
		}
	);

	watch(
		() => workspacesStore.lastDeletedPaths,
		async (deletedPaths) => {
			if (!deletedPaths || !currentPath.value) return;

			const isAffected = deletedPaths.some(
				(deletedPath) =>
					currentPath.value === deletedPath || currentPath.value.startsWith(`${deletedPath}/`)
			);

			if (isAffected) {
				// Invalidate deleted paths from cache
				for (const deletedPath of deletedPaths) {
					directoryCache.invalidate(deletedPath);
				}
				await navigateToHome();
			}
		}
	);

	return {
		currentPath,
		dirContents,
		isLoading,
		isRefreshing,
		error,
		history,
		historyIndex,
		pathInput,
		canGoBack,
		canGoForward,
		parentPath,
		currentDirEntry,
		readDir,
		silentRefresh,
		navigateToPath,
		navigateToEntry,
		navigateToParent,
		navigateToHome,
		goBack,
		goForward,
		refresh,
		handlePathSubmit,
		openFile,
		init,
	};
}
