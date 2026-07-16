import { nextTick, type Ref } from 'vue';
import type { DirEntry } from '@/types/dir-entry';
import type { Layout } from '@/types/navigator';
import { entryPathSelector } from '@/utils/css-escape';

const ROW_TOLERANCE_PX = 30;
const OVERLAP_TOLERANCE_PX = 2;

export function useFileBrowserKeyboardNavigation(options: {
	entries: Ref<DirEntry[]>;
	selectedEntries: Ref<DirEntry[]>;
	layout: () => Layout | undefined;
	selectEntryByPath: (path: string) => boolean;
	goBack: () => void;
	openEntry: (entry: DirEntry) => void;
	entriesContainerRef: Ref<HTMLElement | null>;
	/** Optional callback to scroll to a specific entry index in the virtualized list */
	scrollToEntryIndex?: (index: number) => void;
}) {
	function getAllEntryElements(): HTMLElement[] {
		const container = options.entriesContainerRef.value;

		if (!container) return [];

		return Array.from(container.querySelectorAll<HTMLElement>('[data-entry-path]'));
	}

	function getEntryElement(path: string): HTMLElement | null {
		const container = options.entriesContainerRef.value;

		if (!container) return null;

		return container.querySelector<HTMLElement>(`[data-entry-path="${entryPathSelector(path)}"]`);
	}

	function getLastSelectedEntry(): DirEntry | null {
		const selected = options.selectedEntries.value;
		return selected.length > 0 ? selected[selected.length - 1] : null;
	}

	function findEntryByPath(path: string): DirEntry | undefined {
		return options.entries.value.find((entry) => entry.path === path);
	}

	function findEntryIndex(path: string): number {
		return options.entries.value.findIndex((entry) => entry.path === path);
	}

	async function selectAndFocusEntry(entry: DirEntry) {
		const entryIndex = findEntryIndex(entry.path);

		// If we have a scroll callback, use it to ensure the entry is in the visible range
		if (options.scrollToEntryIndex && entryIndex >= 0) {
			options.scrollToEntryIndex(entryIndex);
		}

		options.selectEntryByPath(entry.path);
		await nextTick();

		const element = getEntryElement(entry.path);

		if (element) {
			element.scrollIntoView({
				block: 'nearest',
				inline: 'nearest',
			});
			element.focus({ preventScroll: true });
		}
	}

	function navigateFlat(direction: 'previous' | 'next') {
		const entries = options.entries.value;

		if (entries.length === 0) return;

		const lastSelected = getLastSelectedEntry();
		let targetIndex: number;

		if (!lastSelected) {
			targetIndex = direction === 'next' ? 0 : entries.length - 1;
		} else {
			const currentIndex = findEntryIndex(lastSelected.path);

			if (currentIndex === -1) {
				targetIndex = direction === 'next' ? 0 : entries.length - 1;
			} else {
				targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
			}
		}

		if (targetIndex < 0 || targetIndex >= entries.length) return;

		const targetEntry = entries[targetIndex];

		if (targetEntry) {
			selectAndFocusEntry(targetEntry);
		}
	}

	function navigateGridVertical(direction: 'up' | 'down') {
		const entries = options.entries.value;

		if (entries.length === 0) return;

		const lastSelected = getLastSelectedEntry();

		if (!lastSelected) {
			selectAndFocusEntry(direction === 'down' ? entries[0] : entries[entries.length - 1]);
			return;
		}

		const currentElement = getEntryElement(lastSelected.path);

		if (!currentElement) {
			// Fallback: if element not rendered, navigate flat
			navigateFlat(direction === 'down' ? 'next' : 'previous');
			return;
		}

		const currentRect = currentElement.getBoundingClientRect();
		const currentCenterX = currentRect.left + currentRect.width / 2;
		const allElements = getAllEntryElements();

		let nearestRowCenterY: number | null = null;

		for (const element of allElements) {
			if (element === currentElement) continue;

			const rect = element.getBoundingClientRect();
			const centerY = rect.top + rect.height / 2;

			if (direction === 'down') {
				if (rect.top >= currentRect.bottom - OVERLAP_TOLERANCE_PX) {
					if (nearestRowCenterY === null || centerY < nearestRowCenterY) {
						nearestRowCenterY = centerY;
					}
				}
			} else {
				if (rect.bottom <= currentRect.top + OVERLAP_TOLERANCE_PX) {
					if (nearestRowCenterY === null || centerY > nearestRowCenterY) {
						nearestRowCenterY = centerY;
					}
				}
			}
		}

		if (nearestRowCenterY === null) return;

		let bestEntry: DirEntry | null = null;
		let bestHorizontalDist = Infinity;

		for (const element of allElements) {
			if (element === currentElement) continue;

			const rect = element.getBoundingClientRect();
			const centerY = rect.top + rect.height / 2;

			if (Math.abs(centerY - nearestRowCenterY) > ROW_TOLERANCE_PX) continue;

			const centerX = rect.left + rect.width / 2;
			const horizontalDist = Math.abs(centerX - currentCenterX);

			if (horizontalDist < bestHorizontalDist) {
				bestHorizontalDist = horizontalDist;
				const path = element.dataset.entryPath;

				if (path) {
					const entry = findEntryByPath(path);

					if (entry) {
						bestEntry = entry;
					}
				}
			}
		}

		if (bestEntry) {
			selectAndFocusEntry(bestEntry);
		}
	}

	function navigateUp() {
		const layout = options.layout();

		if (layout === 'grid') {
			navigateGridVertical('up');
		} else {
			navigateFlat('previous');
		}
	}

	function navigateDown() {
		const layout = options.layout();

		if (layout === 'grid') {
			navigateGridVertical('down');
		} else {
			navigateFlat('next');
		}
	}

	function navigateLeft() {
		navigateFlat('previous');
	}

	function navigateRight() {
		navigateFlat('next');
	}

	function openSelected() {
		const selected = options.selectedEntries.value;

		if (selected.length > 0) {
			options.openEntry(selected[0]);
		}
	}

	function navigateBack() {
		options.goBack();
	}

	return {
		navigateUp,
		navigateDown,
		navigateLeft,
		navigateRight,
		openSelected,
		navigateBack,
	};
}
