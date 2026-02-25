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
	align: 'start',
	sideOffset: 4,
});

const dropdown = inject<any>('dropdown');

const isOpen = computed(() => dropdown?.isOpen.value ?? false);

const getPositionClasses = (side: string, align: string) => {
	const baseClasses =
		'absolute z-50 min-w-[160px] rounded-md border border-slate-200 bg-white shadow-lg';

	const sideClasses = {
		top: 'bottom-full mb-1',
		bottom: 'top-full mt-1',
		left: 'right-full mr-1',
		right: 'left-full ml-1',
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
	if (!target.closest('[dropdown-content]')) {
		dropdown?.closeDropdown();
	}
};
</script>

<template>
	<Teleport to="body">
		<Transition
			name="dropdown"
			@enter="(el) => el.offsetHeight"
			@leave="(el) => el.offsetHeight"
		>
			<div
				v-show="isOpen"
				:class="[getPositionClasses(side, align), $attrs.class]"
				dropdown-content
				@click="(e) => e.stopPropagation()"
			>
				<div class="py-1">
					<slot />
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
@reference "../../../style.css";

.dropdown-enter-active,
.dropdown-leave-active {
	@apply transition-all duration-150 ease-in-out;
}

.dropdown-enter-from {
	@apply opacity-0 scale-95;
}

.dropdown-leave-to {
	@apply opacity-0 scale-95;
}
</style>
