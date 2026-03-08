<script setup lang="ts">
import { inject, ref } from 'vue';

const toggleSub = inject<(value: boolean) => void>('toggleContextMenuSub');

const triggerRef = ref<HTMLDivElement | null>(null);

function handleMouseEnter() {
	toggleSub?.(true);
}

function handleMouseLeave() {
	// Delay a bit to allow moving to submenu
	setTimeout(() => {
		const submenu = triggerRef.value?.parentElement?.querySelector('.context-menu-subcontent');
		if (submenu && !submenu.matches(':hover')) {
			toggleSub?.(false);
		}
	}, 100);
}
</script>

<template>
  <div
    ref="triggerRef"
    class="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-primary hover:text-accent-foreground focus:bg-primary focus:text-accent-foreground group"
    role="menuitem"
    tabindex="0"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <slot />
    <svg
      class="ml-auto h-4 w-4"
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.1584 3.13508C6.35985 2.94621 6.67627 2.95642 6.86514 3.15788L10.6151 7.15788C10.7954 7.3502 10.7954 7.64949 10.6151 7.84182L6.86514 11.8418C6.67627 12.0433 6.35985 12.0535 6.1584 11.8646C5.95694 11.6757 5.94673 11.3593 6.1356 11.1579L9.565 7.49985L6.1356 3.84182C5.94673 3.64036 5.95694 3.32394 6.1584 3.13508Z"
        fill="currentColor"
        fill-rule="evenodd"
        clip-rule="evenodd"
      ></path>
    </svg>
  </div>
</template>
