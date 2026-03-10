<script setup lang="ts">
import { inject, type Ref } from 'vue';

const isSubOpen = inject<Ref<boolean>>('contextMenuSubOpen');
const toggleSub = inject<(value: boolean) => void>('toggleContextMenuSub');

function handleMouseLeave() {
	toggleSub?.(false);
}
</script>

<template>
  <div
    v-if="isSubOpen"
    class="absolute left-full top-0 z-51 min-w-50 overflow-hidden ml-1 rounded-corner border border-ui-border bg-ui-bg/80 p-1 text-popover-foreground shadow-lg backdrop-blur-md context-menu-subcontent"
    @mouseleave="handleMouseLeave"
  >
    <slot />
  </div>
</template>
