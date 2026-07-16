import { type InjectionKey, onUnmounted, watch } from 'vue';
import { useDragStateStore } from '@/stores/runtime/drag-state';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { TabGroup } from '@/types/workspaces';

const TAB_HOVER_ACTIVATION_DELAY = 800;

export interface DragTabActivationContext {
	registerTab: (tabGroup: TabGroup, element: HTMLElement) => void;
	unregisterTab: (tabGroup: TabGroup) => void;
}

export const DRAG_TAB_ACTIVATION_KEY: InjectionKey<DragTabActivationContext> =
	Symbol('drag-tab-activation');

/**
 * Composable that activates a tab when dragged items hover over it for 800ms.
 * Used in the TabBarComponent to enable drag-to-tab-switch functionality.
 */
export function useDragTabActivation() {
	const dragStateStore = useDragStateStore();
	const workspacesStore = useWorkspacesStore();

	let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
	let currentHoveredTabGroup: TabGroup | null = null;
	let registeredTabs: Array<{ tabGroup: TabGroup; element: HTMLElement }> = [];

	function registerTab(tabGroup: TabGroup, element: HTMLElement) {
		// Remove existing registration for same tabGroup if any
		registeredTabs = registeredTabs.filter((t) => t.tabGroup !== tabGroup);
		registeredTabs.push({ tabGroup, element });
	}

	function unregisterTab(tabGroup: TabGroup) {
		registeredTabs = registeredTabs.filter((t) => t.tabGroup !== tabGroup);
	}

	function findTabAtPosition(x: number, y: number): TabGroup | null {
		for (const { tabGroup, element } of registeredTabs) {
			const rect = element.getBoundingClientRect();
			if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
				return tabGroup;
			}
		}
		return null;
	}

	function clearHoverTimeout() {
		if (hoverTimeout !== null) {
			clearTimeout(hoverTimeout);
			hoverTimeout = null;
		}
		currentHoveredTabGroup = null;
	}

	function handleCursorUpdate(x: number, y: number) {
		if (!dragStateStore.isDragging) {
			clearHoverTimeout();
			return;
		}

		const hoveredTab = findTabAtPosition(x, y);

		if (!hoveredTab) {
			clearHoverTimeout();
			return;
		}

		// Check if it's the currently active tab — no need to switch
		const currentIndex = workspacesStore.currentWorkspace?.currentTabGroupIndex;
		const tabGroups = workspacesStore.currentWorkspace?.tabGroups ?? [];
		const hoveredIndex = tabGroups.indexOf(hoveredTab);
		if (hoveredIndex === currentIndex) {
			clearHoverTimeout();
			return;
		}

		// If we're already hovering the same tab, let the timeout continue
		if (currentHoveredTabGroup === hoveredTab) {
			return;
		}

		// New tab hovered — reset timer
		clearHoverTimeout();
		currentHoveredTabGroup = hoveredTab;

		hoverTimeout = setTimeout(() => {
			if (currentHoveredTabGroup === hoveredTab && dragStateStore.isDragging) {
				workspacesStore.openTabGroup(hoveredTab);
			}
			hoverTimeout = null;
			currentHoveredTabGroup = null;
		}, TAB_HOVER_ACTIVATION_DELAY);
	}

	// Watch cursor position changes during drag
	const stopWatchX = watch(
		() => dragStateStore.cursorX,
		() => handleCursorUpdate(dragStateStore.cursorX, dragStateStore.cursorY)
	);

	const stopWatchY = watch(
		() => dragStateStore.cursorY,
		() => handleCursorUpdate(dragStateStore.cursorX, dragStateStore.cursorY)
	);

	// Clear timeout when drag ends
	const stopWatchDrag = watch(
		() => dragStateStore.isDragging,
		(isDragging) => {
			if (!isDragging) {
				clearHoverTimeout();
			}
		}
	);

	onUnmounted(() => {
		clearHoverTimeout();
		registeredTabs = [];
		stopWatchX();
		stopWatchY();
		stopWatchDrag();
	});

	return {
		registerTab,
		unregisterTab,
		clearHoverTimeout,
	};
}
