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
  <ScrollArea class="file-browser-loading">
    <div class="file-browser-loading__list">
      <div v-for="skeletonIndex in 12" :key="skeletonIndex" class="file-browser-loading__row">
        <div class="file-browser-loading__name">
          <Skeleton class="file-browser-loading__icon" />
          <Skeleton class="file-browser-loading__text" />
        </div>
        <Skeleton v-if="columnVisibility.items" class="file-browser-loading__items" />
        <Skeleton v-if="columnVisibility.size" class="file-browser-loading__size" />
        <Skeleton v-if="columnVisibility.modified" class="file-browser-loading__modified" />
      </div>
    </div>
  </ScrollArea>
</template>

<style scoped>
.file-browser-loading {
  animation: sigma-ui-fade-in 1s ease-out;
}

.file-browser-loading__list {
  display: flex;
  flex-direction: column;
  padding-right: var(--file-browser-list-right-gutter);
}

.file-browser-loading__row {
  display: grid;
  padding: var(--file-browser-list-row-padding-y) var(--file-browser-list-row-padding-x);
  grid-template-columns: var(--file-browser-list-columns);
}

.file-browser-loading__name {
  display: flex;
  align-items: center;
  padding-right: var(--file-browser-list-cell-padding-right);
  gap: 10px;
}

.file-browser-loading__icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 4px;
}

.file-browser-loading__text {
  width: 60%;
  height: 14px;
  border-radius: 4px;
}

.file-browser-loading__items {
  width: 30px;
  height: 14px;
  border-radius: 4px;
}

.file-browser-loading__size {
  width: 50px;
  height: 14px;
  border-radius: 4px;
}

.file-browser-loading__modified {
  width: 100px;
  height: 14px;
  border-radius: 4px;
}
</style>