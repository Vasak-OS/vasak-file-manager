<script setup lang="ts">
import { inject, type Ref, ref } from 'vue';

const isSubOpen = inject<Ref<boolean>>('contextMenuSubOpen');
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
    class="context-menu-subtrigger"
    role="menuitem"
    tabindex="0"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <slot />
    <svg
      class="context-menu-subtrigger-icon"
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

<style scoped>
.context-menu-subtrigger {
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

.context-menu-subtrigger:hover {
  background-color: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

.context-menu-subtrigger:focus {
  background-color: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

.context-menu-subtrigger-icon {
  margin-left: auto;
  width: 1rem;
  height: 1rem;
}
</style>
