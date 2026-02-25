<script setup lang="ts">
import { inject, onMounted, onUnmounted, type Ref, ref, watch } from 'vue';

const isOpen = inject<Ref<boolean>>('contextMenuOpen');
const position = inject<Ref<{ x: number; y: number }>>('contextMenuPosition');
const closeMenu = inject<() => void>('closeContextMenu');

const menuRef = ref<HTMLDivElement | null>(null);

function handleClickOutside(event: MouseEvent) {
	if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
		closeMenu?.();
	}
}

function handleEscape(event: KeyboardEvent) {
	if (event.key === 'Escape') {
		closeMenu?.();
	}
}

watch(isOpen, (value) => {
	if (value) {
		document.addEventListener('click', handleClickOutside);
		document.addEventListener('keydown', handleEscape);
	} else {
		document.removeEventListener('click', handleClickOutside);
		document.removeEventListener('keydown', handleEscape);
	}
});

onUnmounted(() => {
	document.removeEventListener('click', handleClickOutside);
	document.removeEventListener('keydown', handleEscape);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen?.value"
      ref="menuRef"
      class="context-menu-content"
      :style="{
        left: `${position?.value.x}px`,
        top: `${position?.value.y}px`,
      }"
    >
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu-content {
  position: fixed;
  z-index: 50;
  min-width: 200px;
  overflow: hidden;
  border-radius: 0.375rem;
  border: 1px solid hsl(var(--border));
  background-color: hsl(var(--popover));
  padding: 0.25rem;
  color: hsl(var(--popover-foreground));
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
}
</style>
