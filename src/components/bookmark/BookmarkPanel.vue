<script lang="ts" setup>
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { markRaw, ref, onMounted, onUnmounted, watch } from 'vue';
import { useReactiveIcon } from '@/composables/useReactiveIcon';
import { useBookmarksStore, type BookmarkEntry } from '@/stores/storage/bookmarks';
import { useDragStateStore } from '@/stores/runtime/drag-state';
import BookmarkNotFoundToast from '@/components/ui/toast/BookmarkNotFoundToast.vue';
import { toast } from '@/components/ui/toast/toaster';
import ScrollArea from '@/components/ui/ScrollArea.vue';

const emit = defineEmits<{
	navigate: [path: string];
}>();

const bookmarksStore = useBookmarksStore();
const dragStateStore = useDragStateStore();

// Icons
const folderIcon = useReactiveIcon(() => getIconSource('folder'));
const warningIcon = useReactiveIcon(() => getIconSource('dialog-warning'));
const chevronDownIcon = useReactiveIcon(() => getIconSource('go-down'));
const chevronRightIcon = useReactiveIcon(() => getIconSource('go-next'));

// Section collapse state
const collapsedSections = ref<Record<'favorites' | 'history' | 'frequent', boolean>>({
	favorites: false,
	history: false,
	frequent: false,
});

function toggleSection(section: 'favorites' | 'history' | 'frequent') {
	collapsedSections.value[section] = !collapsedSections.value[section];
}

function handleItemClick(entry: BookmarkEntry) {
	if (!entry.exists) {
		// Requirement 7.7: Show message and offer to remove
		toast.custom(markRaw(BookmarkNotFoundToast), {
			componentProps: {
				path: entry.path,
				onRemove: () => {
					bookmarksStore.removeFavorite(entry.path);
				},
			},
			duration: 8000,
		});
		return;
	}
	emit('navigate', entry.path);
}

// --- Drag & Drop: Internal drag from file browser (Requirement 7.3, 7.8) ---
const isDragOverFavorites = ref(false);
const dropIndicatorIndex = ref<number | null>(null);
const favoritesDropZoneRef = ref<HTMLElement | null>(null);

function handleInternalDragDrop() {
	if (!dragStateStore.isDragging) return;

	// Only accept directories (Requirement 7.8)
	const directories = dragStateStore.dragItems.filter((item) => item.is_dir);
	if (directories.length === 0) return;

	for (const dir of directories) {
		if (!bookmarksStore.isFavorite(dir.path)) {
			bookmarksStore.addFavorite(dir.path);
		}
	}
}

function handleMouseMoveForDrop(event: MouseEvent) {
	if (!dragStateStore.isDragging) {
		if (isDragOverFavorites.value && draggedFavoriteIndex.value === null) {
			isDragOverFavorites.value = false;
		}
		return;
	}

	if (!favoritesDropZoneRef.value) return;

	const rect = favoritesDropZoneRef.value.getBoundingClientRect();
	const isOver =
		event.clientX >= rect.left &&
		event.clientX <= rect.right &&
		event.clientY >= rect.top &&
		event.clientY <= rect.bottom;

	isDragOverFavorites.value = isOver && dragStateStore.hasDraggedDirectories;
}

function handleMouseUpForDrop() {
	if (!dragStateStore.isDragging || !isDragOverFavorites.value) return;

	handleInternalDragDrop();
	isDragOverFavorites.value = false;
}

watch(
	() => dragStateStore.isDragging,
	(dragging) => {
		if (!dragging) {
			isDragOverFavorites.value = false;
		}
	}
);

onMounted(() => {
	bookmarksStore.syncFromUserStats();
	document.addEventListener('mousemove', handleMouseMoveForDrop);
	document.addEventListener('mouseup', handleMouseUpForDrop);
});

onUnmounted(() => {
	document.removeEventListener('mousemove', handleMouseMoveForDrop);
	document.removeEventListener('mouseup', handleMouseUpForDrop);
});

// --- Drag & Drop: HTML5 external drop (from OS or other sources) ---
function handleFavoritesDragOver(event: DragEvent) {
	if (event.dataTransfer) {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'link';
		isDragOverFavorites.value = true;
	}
}

function handleFavoritesDragEnter(event: DragEvent) {
	event.preventDefault();
	isDragOverFavorites.value = true;
}

function handleFavoritesDragLeave(event: DragEvent) {
	const relatedTarget = event.relatedTarget as HTMLElement | null;
	const currentTarget = event.currentTarget as HTMLElement;
	if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
		isDragOverFavorites.value = false;
		dropIndicatorIndex.value = null;
	}
}

function handleFavoritesDrop(event: DragEvent) {
	event.preventDefault();
	isDragOverFavorites.value = false;
	dropIndicatorIndex.value = null;

	if (!event.dataTransfer) return;

	let entryData: { path: string; is_dir: boolean } | null = null;

	const customData = event.dataTransfer.getData('application/x-vasak-entry');
	if (customData) {
		try {
			entryData = JSON.parse(customData);
		} catch {
			// ignore parse error
		}
	}

	// Fallback: try text/plain (path only, assume directory)
	if (!entryData) {
		const textData = event.dataTransfer.getData('text/plain');
		if (textData && textData.startsWith('/')) {
			entryData = { path: textData, is_dir: true };
		}
	}

	if (!entryData) return;

	// Requirement 7.8: Only accept directories
	if (!entryData.is_dir) {
		return;
	}

	if (!bookmarksStore.isFavorite(entryData.path)) {
		bookmarksStore.addFavorite(entryData.path);
	}
}

// --- Drag & Drop: Reorder favorites (Requirement 7.4) ---
const draggedFavoriteIndex = ref<number | null>(null);

function handleFavoriteItemDragStart(event: DragEvent, index: number) {
	draggedFavoriteIndex.value = index;
	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', bookmarksStore.favorites[index].path);
	}
}

function handleFavoriteItemDragOver(event: DragEvent, index: number) {
	event.preventDefault();
	if (draggedFavoriteIndex.value !== null && draggedFavoriteIndex.value !== index) {
		dropIndicatorIndex.value = index;
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
	}
}

function handleFavoriteItemDrop(event: DragEvent, index: number) {
	event.preventDefault();
	event.stopPropagation();

	if (draggedFavoriteIndex.value !== null && draggedFavoriteIndex.value !== index) {
		bookmarksStore.reorderFavorite(draggedFavoriteIndex.value, index);
	}

	draggedFavoriteIndex.value = null;
	dropIndicatorIndex.value = null;
}

function handleFavoriteItemDragEnd() {
	draggedFavoriteIndex.value = null;
	dropIndicatorIndex.value = null;
}
</script>

<template>
  <div class="flex flex-col h-full w-full text-sm">
    <ScrollArea class="flex-1">
      <div class="flex flex-col gap-1 p-2">

        <!-- Favorites Section -->
        <div class="flex flex-col">
          <button
            class="flex items-center gap-1.5 px-2 py-1.5 rounded-corner hover:bg-ui-surface/80 text-left font-medium text-xs uppercase tracking-wide text-ui-text/70"
            @click="toggleSection('favorites')"
          >
            <img
              :src="collapsedSections.favorites ? chevronRightIcon : chevronDownIcon"
              class="h-3.5 w-3.5 transition-transform duration-200"
              alt=""
            />
            <span>Favoritos</span>
            <span class="ml-auto text-ui-text/40 text-[10px]">{{ bookmarksStore.favorites.length }}</span>
          </button>

          <div
            class="overflow-hidden transition-all duration-200 ease-in-out"
            :class="collapsedSections.favorites ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'"
          >
            <div
              ref="favoritesDropZoneRef"
              class="flex flex-col gap-0.5 pl-2 rounded-corner transition-colors duration-150"
              :class="{ 'bg-primary/10 ring-1 ring-primary/30': isDragOverFavorites && draggedFavoriteIndex === null }"
              @dragover="handleFavoritesDragOver"
              @dragenter="handleFavoritesDragEnter"
              @dragleave="handleFavoritesDragLeave"
              @drop="handleFavoritesDrop"
            >
              <button
                v-for="(entry, index) in bookmarksStore.favorites"
                :key="entry.path"
                draggable="true"
                class="flex items-center gap-2 px-2 py-1.5 rounded-corner hover:bg-ui-surface/80 text-left w-full group transition-all duration-100"
                :class="{
                  'opacity-50': !entry.exists,
                  'opacity-40': draggedFavoriteIndex === index,
                  'border-t-2 border-primary': dropIndicatorIndex === index && draggedFavoriteIndex !== null,
                }"
                :title="entry.path"
                @click="handleItemClick(entry)"
                @dragstart="handleFavoriteItemDragStart($event, index)"
                @dragover="handleFavoriteItemDragOver($event, index)"
                @drop="handleFavoriteItemDrop($event, index)"
                @dragend="handleFavoriteItemDragEnd"
              >
                <img :src="folderIcon" class="h-4 w-4 shrink-0" alt="" />
                <div class="flex flex-col min-w-0 flex-1">
                  <span class="truncate text-ui-text text-xs">{{ entry.name }}</span>
                  <span class="truncate text-ui-text/50 text-[10px]">{{ entry.path }}</span>
                </div>
                <img
                  v-if="!entry.exists"
                  :src="warningIcon"
                  class="h-3.5 w-3.5 shrink-0"
                  alt="Path not found"
                />
              </button>

              <div
                v-if="bookmarksStore.favorites.length === 0"
                class="px-2 py-2 text-ui-text/40 text-xs italic"
              >
                No favorites yet
              </div>
            </div>
          </div>
        </div>

        <!-- Recent History Section -->
        <div class="flex flex-col">
          <button
            class="flex items-center gap-1.5 px-2 py-1.5 rounded-corner hover:bg-ui-surface/80 text-left font-medium text-xs uppercase tracking-wide text-ui-text/70"
            @click="toggleSection('history')"
          >
            <img
              :src="collapsedSections.history ? chevronRightIcon : chevronDownIcon"
              class="h-3.5 w-3.5 transition-transform duration-200"
              alt=""
            />
            <span>Historial Reciente</span>
            <span class="ml-auto text-ui-text/40 text-[10px]">{{ bookmarksStore.history.length }}</span>
          </button>

          <div
            class="overflow-hidden transition-all duration-200 ease-in-out"
            :class="collapsedSections.history ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'"
          >
            <div class="flex flex-col gap-0.5 pl-2">
              <button
                v-for="entry in bookmarksStore.history"
                :key="entry.path"
                class="flex items-center gap-2 px-2 py-1.5 rounded-corner hover:bg-ui-surface/80 text-left w-full group"
                :class="{ 'opacity-50': !entry.exists }"
                :title="entry.path"
                @click="handleItemClick(entry)"
              >
                <img :src="folderIcon" class="h-4 w-4 shrink-0" alt="" />
                <div class="flex flex-col min-w-0 flex-1">
                  <span class="truncate text-ui-text text-xs">{{ entry.name }}</span>
                  <span class="truncate text-ui-text/50 text-[10px]">{{ entry.path }}</span>
                </div>
                <img
                  v-if="!entry.exists"
                  :src="warningIcon"
                  class="h-3.5 w-3.5 shrink-0"
                  alt="Path not found"
                />
              </button>

              <div
                v-if="bookmarksStore.history.length === 0"
                class="px-2 py-2 text-ui-text/40 text-xs italic"
              >
                No recent history
              </div>
            </div>
          </div>
        </div>

        <!-- Frequently Used Section -->
        <div class="flex flex-col">
          <button
            class="flex items-center gap-1.5 px-2 py-1.5 rounded-corner hover:bg-ui-surface/80 text-left font-medium text-xs uppercase tracking-wide text-ui-text/70"
            @click="toggleSection('frequent')"
          >
            <img
              :src="collapsedSections.frequent ? chevronRightIcon : chevronDownIcon"
              class="h-3.5 w-3.5 transition-transform duration-200"
              alt=""
            />
            <span>Frecuentes</span>
            <span class="ml-auto text-ui-text/40 text-[10px]">{{ bookmarksStore.frequent.length }}</span>
          </button>

          <div
            class="overflow-hidden transition-all duration-200 ease-in-out"
            :class="collapsedSections.frequent ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'"
          >
            <div class="flex flex-col gap-0.5 pl-2">
              <button
                v-for="entry in bookmarksStore.frequent"
                :key="entry.path"
                class="flex items-center gap-2 px-2 py-1.5 rounded-corner hover:bg-ui-surface/80 text-left w-full group"
                :class="{ 'opacity-50': !entry.exists }"
                :title="entry.path"
                @click="handleItemClick(entry)"
              >
                <img :src="folderIcon" class="h-4 w-4 shrink-0" alt="" />
                <div class="flex flex-col min-w-0 flex-1">
                  <span class="truncate text-ui-text text-xs">{{ entry.name }}</span>
                  <span class="truncate text-ui-text/50 text-[10px]">{{ entry.path }}</span>
                </div>
                <img
                  v-if="!entry.exists"
                  :src="warningIcon"
                  class="h-3.5 w-3.5 shrink-0"
                  alt="Path not found"
                />
              </button>

              <div
                v-if="bookmarksStore.frequent.length === 0"
                class="px-2 py-2 text-ui-text/40 text-xs italic"
              >
                No frequent directories
              </div>
            </div>
          </div>
        </div>

      </div>
    </ScrollArea>
  </div>
</template>
