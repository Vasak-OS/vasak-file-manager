<script setup lang="ts">
import { computed, inject } from 'vue';

interface Props {
	side?: 'top' | 'bottom' | 'left' | 'right';
	align?: 'start' | 'center' | 'end';
	sideOffset?: number;
	class?: string;
}

withDefaults(defineProps<Props>(), {
	side: 'bottom',
	align: 'center',
	sideOffset: 4,
});

const popover = inject<any>('popover');

const isOpen = computed(() => popover?.isOpen.value ?? false);

const getPositionClasses = (side: string, align: string) => {
	const baseClasses = 'absolute z-50 rounded-md border border-slate-200 bg-white shadow-lg';

	const sideClasses = {
		top: 'bottom-full mb-2',
		bottom: 'top-full mt-2',
		left: 'right-full mr-2',
		right: 'left-full ml-2',
	}[side];

	const alignClasses = {
		start: 'left-0',
		center: 'left-1/2 -translate-x-1/2',
		end: 'right-0',
	}[align];

	return `${baseClasses} ${sideClasses} ${alignClasses}`;
};

const handleClickOutside = (event: MouseEvent) => {
	const target = event.target as HTMLElement;
	if (!target.closest('[popover-content]')) {
		popover?.closePopover();
	}
};
</script>

<template>
	<Teleport to="body">
		<Transition
			name="popover"
			@enter="(el) => el.offsetHeight"
			@leave="(el) => el.offsetHeight"
		>
			<div
				v-show="isOpen"
				:class="[getPositionClasses(side, align), $attrs.class]"
				popover-content
				@click="(e) => e.stopPropagation()"
			>
				<slot />
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
@reference "../../../style.css";

.popover-enter-active,
.popover-leave-active {
	@apply transition-all duration-150 ease-in-out;
}

.popover-enter-from {
	@apply opacity-0 scale-95;
}

.popover-leave-to {
	@apply opacity-0 scale-95;
}
</style>
