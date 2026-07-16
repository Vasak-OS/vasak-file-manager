import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { DirEntry } from '@/types/dir-entry';

/**
 * Shared drag state store.
 * Bridges the custom file-browser drag system with external drop targets
 * like the BookmarkPanel, so they can react to ongoing drags.
 */
export const useDragStateStore = defineStore('drag-state', () => {
	const isDragging = ref(false);
	const dragItems = ref<DirEntry[]>([]);
	const cursorX = ref(0);
	const cursorY = ref(0);

	const hasDraggedDirectories = computed(() => {
		return dragItems.value.some((item) => item.is_dir);
	});

	const hasDraggedFiles = computed(() => {
		return dragItems.value.some((item) => item.is_file);
	});

	function startDrag(items: DirEntry[]) {
		isDragging.value = true;
		dragItems.value = [...items];
	}

	function updateCursor(x: number, y: number) {
		cursorX.value = x;
		cursorY.value = y;
	}

	function endDrag() {
		isDragging.value = false;
		dragItems.value = [];
		cursorX.value = 0;
		cursorY.value = 0;
	}

	return {
		isDragging,
		dragItems,
		cursorX,
		cursorY,
		hasDraggedDirectories,
		hasDraggedFiles,
		startDrag,
		updateCursor,
		endDrag,
	};
});
