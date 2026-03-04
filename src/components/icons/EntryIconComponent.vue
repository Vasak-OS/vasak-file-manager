<script setup lang="ts">
import {  onMounted, ref } from 'vue';
import type { DirEntry } from '@/types/dir-entry';
import { getFileIcon } from '@/utils/images';

const props = defineProps<{
	entry: DirEntry;
	size: number;
}>();

const icon = ref<string>('');

onMounted(async () => {
	icon.value = await getFileIcon(props.entry);
});
</script>

<template>
  <img :src="icon" :alt="props.entry.name" />
</template>