<script setup lang="ts">
import { inject, type Ref, ref, watch } from 'vue';

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

if (isOpen) {
	watch(isOpen, (value) => {
		if (value) {
			document.addEventListener('click', handleClickOutside);
			document.addEventListener('keydown', handleEscape);
		} else {
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		}
	});
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      ref="menuRef"
			class="fixed z-50 min-w-50 overflow-visible rounded-corner border border-ui-border p-1 text-popover-foreground shadow-lg bg-ui-bg/80 backdrop-blur-md"
      :style="{
        left: position ? `${position.x}px` : '0px',
        top: position ? `${position.y}px` : '0px',
      }"
    >
      <slot />
    </div>
  </Teleport>
</template>
