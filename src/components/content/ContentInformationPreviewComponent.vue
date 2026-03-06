<script setup lang="ts">
import { convertFileSrc } from '@tauri-apps/api/core';
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { computed, onMounted, ref } from 'vue';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import type { DirEntry } from '@/types/dir-entry';
import { isImageFile as checkIsImage, isVideoFile as checkIsVideo } from '@/utils/files';

const props = defineProps<{
	selectedEntry: DirEntry | null;
	isCurrentDir?: boolean;
}>();

const fileIcon = ref('');

const isImageFile = computed(() => {
	if (!props.selectedEntry) return false;

	return checkIsImage(props.selectedEntry);
});

const isVideoFile = computed(() => {
	if (!props.selectedEntry) return false;

	return checkIsVideo(props.selectedEntry);
});

const mediaSrc = computed(() => {
	if (!props.selectedEntry?.path) return '';

	return convertFileSrc(props.selectedEntry.path);
});

onMounted(async () => {
	fileIcon.value = await getIconSource('folder');
});
</script>

<template>
  <div class="flex overflow-hidden h-44 items-center justify-center rounded-corner bg-ui-bg/80">
    <div v-if="!selectedEntry" class="flex items-center justify-center">
      <img :src="fileIcon" class="h-12 w-12" />
    </div>
    <div v-else-if="isImageFile" class="flex overflow-hidden w-full h-full items-center justify-center">
      <img :src="mediaSrc" :alt="selectedEntry.name" class="h-full w-full object-cover rounded-corner" />
    </div>
    <div v-else-if="isVideoFile" class="flex overflow-hidden w-full h-full items-center justify-center">
      <video :src="mediaSrc" class="h-full w-full object-cover rounded-corner" controls preload="metadata" />
    </div>
    <div v-else class="flex items-center justify-center">
       <EntryIconComponent :entry="selectedEntry" class="h-12 w-12" />
    </div>
  </div>
</template>
