<script setup lang="ts">
import { inject } from 'vue';

const emit = defineEmits<{
	select: [];
}>();

const closeMenu = inject<() => void>('closeContextMenu');

function handleClick() {
	emit('select');
	closeMenu?.();
}
</script>

<template>
  <div
    class="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
    role="menuitem"
    tabindex="0"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
  >
    <slot />
  </div>
</template>
