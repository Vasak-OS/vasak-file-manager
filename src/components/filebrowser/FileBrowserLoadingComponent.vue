<script setup lang="ts">
import { Skeleton } from '@vasakgroup/vue-libvasak';
import type { ListColumnVisibility } from '@/composables/file-browser/list-columns';

// Las mismas columnas que la lista, para que los esqueletos no se desalineen
// con la plantilla del grid cuando el ancho esconde una.
withDefaults(defineProps<{ columnVisibility?: ListColumnVisibility }>(), {
	columnVisibility: () => ({ items: true, size: true, modified: true }),
});
</script>

<template>
  <div class="h-full w-full overflow-x-hidden overflow-y-auto">
    <div class="flex flex-col pr-[var(--file-browser-list-right-gutter)]">
      <div v-for="skeletonIndex in 12" :key="skeletonIndex" class="grid py-[var(--file-browser-list-row-padding-y)] px-[var(--file-browser-list-row-padding-x)] [grid-template-columns:var(--file-browser-list-columns)]">
        <div class="flex items-center pr-[var(--file-browser-list-cell-padding-right)] gap-[10px]">
          <Skeleton :width="18" :height="18" shape="block" class="shrink-0" />
          <Skeleton width="60%" :height="14" />
        </div>
        <Skeleton v-if="columnVisibility.items" :width="30" :height="14" />
        <Skeleton v-if="columnVisibility.size" :width="50" :height="14" />
        <Skeleton v-if="columnVisibility.modified" :width="100" :height="14" />
      </div>
    </div>
  </div>
</template>
