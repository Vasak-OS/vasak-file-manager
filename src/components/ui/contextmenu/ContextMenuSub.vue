<script setup lang="ts">
import { provide, ref } from 'vue';

const isSubOpen = ref(false);

provide('contextMenuSubOpen', isSubOpen);

function toggleSub(value: boolean) {
	isSubOpen.value = value;
}

provide('toggleContextMenuSub', toggleSub);
</script>

<template>
  <div class="context-menu-sub">
    <slot />
  </div>
</template>

<style scoped>
.context-menu-sub {
  position: relative;
}
</style>
