<script setup lang="ts">
import { inject, onMounted, onUnmounted, type Ref, ref } from 'vue';

const isSubOpen = inject<Ref<boolean>>('contextMenuSubOpen');
const toggleSub = inject<(value: boolean) => void>('toggleContextMenuSub');

const contentRef = ref<HTMLDivElement | null>(null);

function handleMouseLeave() {
	toggleSub?.(false);
}
</script>

<template>
  <div
    v-if="isSubOpen?.value"
    ref="contentRef"
    class="context-menu-subcontent"
    @mouseleave="handleMouseLeave"
  >
    <slot />
  </div>
</template>

<style scoped>
.context-menu-subcontent {
  position: absolute;
  left: 100%;
  top: 0;
  z-index: 51;
  min-width: 200px;
  overflow: hidden;
  margin-left: 0.25rem;
  border-radius: 0.375rem;
  border: 1px solid hsl(var(--border));
  background-color: hsl(var(--popover));
  padding: 0.25rem;
  color: hsl(var(--popover-foreground));
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
}
</style>
