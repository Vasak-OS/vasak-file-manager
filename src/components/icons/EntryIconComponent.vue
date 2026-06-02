<script setup lang="ts">
import type { DirEntry } from '@/types/dir-entry';
import { getFileIcon } from '@/utils/images';
import { useReactiveIcon } from '@/composables/useReactiveIcon';

const props = defineProps<{
	entry: DirEntry;
}>();

const icon = useReactiveIcon(() => getFileIcon(props.entry));
</script>

<template>
  <img :src="icon" :alt="props.entry.name" />
</template>