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
    class="context-menu-item"
    role="menuitem"
    tabindex="0"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
  >
    <slot />
  </div>
</template>

<style scoped>
.context-menu-item {
  position: relative;
  display: flex;
  cursor: pointer;
  user-select: none;
  align-items: center;
  border-radius: 0.25rem;
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  outline: none;
  transition: background-color 0.2s;
}

.context-menu-item:hover {
  background-color: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

.context-menu-item:focus {
  background-color: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}
</style>
