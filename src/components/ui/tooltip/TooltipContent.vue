<script setup lang="ts">
import { computed, inject } from 'vue';

interface Props {
	side?: 'top' | 'bottom' | 'left' | 'right';
	align?: 'start' | 'center' | 'end';
	sideOffset?: number;
	delayDuration?: number;
}

withDefaults(defineProps<Props>(), {
	side: 'bottom',
	align: 'center',
	sideOffset: 4,
	delayDuration: 200,
});

const tooltip = inject<any>('tooltip');

const isOpen = computed(() => tooltip?.isOpen.value ?? false);

const getPositionClasses = (side: string, align: string) => {
	const baseClasses =
		'absolute z-50 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-sm text-slate-50 shadow-md';

	const sideClasses = {
		top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
		bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
		left: 'right-full mr-2 top-1/2 -translate-y-1/2',
		right: 'left-full ml-2 top-1/2 -translate-y-1/2',
	}[side];

	return `${baseClasses} ${sideClasses}`;
};
</script>

<template>
	<Transition
		name="tooltip"
		@enter="(el) => (el as HTMLElement).offsetHeight"
		@leave="(el) => (el as HTMLElement).offsetHeight"
	>
		<div
			v-show="isOpen"
			:class="getPositionClasses(side, align)"
			class="pointer-events-none"
		>
			<slot />
		</div>
	</Transition>
</template>

<style scoped>
@reference "../../../style.css";

.tooltip-enter-active,
.tooltip-leave-active {
	@apply transition-all duration-200 ease-in-out;
}

.tooltip-enter-from {
	@apply opacity-0 scale-95;
}

.tooltip-leave-to {
	@apply opacity-0 scale-95;
}
</style>
