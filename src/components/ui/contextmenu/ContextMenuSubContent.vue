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
    class="absolute left-full top-0 z-51 min-w-[200px] overflow-hidden ml-1 rounded-md border border-ui-border bg-popover p-1 text-popover-foreground shadow-[0_10px_15px_-3px_rgb(0_0_0/0.1),0_4px_6px_-4px_rgb(0_0_0/0.1)]"
    @mouseleave="handleMouseLeave"
  >
    <slot />
  </div>
</template>
