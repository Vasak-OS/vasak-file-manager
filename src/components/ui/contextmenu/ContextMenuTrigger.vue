<script setup lang="ts">
import { inject, type Ref } from 'vue';

const isOpen = inject<Ref<boolean>>('contextMenuOpen');
const position = inject<Ref<{ x: number; y: number }>>('contextMenuPosition');

function handleContextMenu(event: MouseEvent) {
	event.preventDefault();
	event.stopPropagation();

	if (isOpen && position) {
		position.value = { x: event.clientX, y: event.clientY };
		isOpen.value = true;
	}
}
</script>

<template>
  <div class="context-menu-trigger" @contextmenu="handleContextMenu">
    <slot />
  </div>
</template>

<style scoped>
.context-menu-trigger {
  display: contents;
}
</style>
