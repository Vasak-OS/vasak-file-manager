<script setup lang="ts">
import { ref } from 'vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import Skeleton from '@/components/ui/Skeleton.vue';

const columnVisibility = ref({
	items: true,
	size: true,
	modified: true,
});
</script>

<template>
  <ScrollArea class="animate-in fade-in duration-1000">
    <div class="flex flex-col pr-[var(--file-browser-list-right-gutter)]">
      <div v-for="skeletonIndex in 12" :key="skeletonIndex" class="grid py-[var(--file-browser-list-row-padding-y)] px-[var(--file-browser-list-row-padding-x)] [grid-template-columns:var(--file-browser-list-columns)]">
        <div class="flex items-center pr-[var(--file-browser-list-cell-padding-right)] gap-[10px]">
          <Skeleton class="w-[18px] h-[18px] shrink-0 rounded" />
          <Skeleton class="w-[60%] h-[14px] rounded" />
        </div>
        <Skeleton v-if="columnVisibility.items" class="w-[30px] h-[14px] rounded" />
        <Skeleton v-if="columnVisibility.size" class="w-[50px] h-[14px] rounded" />
        <Skeleton v-if="columnVisibility.modified" class="w-[100px] h-[14px] rounded" />
      </div>
    </div>
  </ScrollArea>
</template>
