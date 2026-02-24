<script lang="ts" setup>
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { onMounted, ref } from 'vue';

const folderIcon = ref('');

onMounted(async () => {
	folderIcon.value = await getIconSource('folder');
});
</script>

<template>
  <div class="h-screen w-10 background rounded-l-corner-window justify-between flex p-1">
    <div>
      <div class="mb-2 p-1">
        <img :src="folderIcon" class="h-6 w-6 inline-block" alt="Home">
      </div>
    </div>
    <div></div>
  </div>
</template>