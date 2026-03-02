<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue';

interface Props {
	side?: 'top' | 'bottom' | 'left' | 'right';
	align?: 'start' | 'center' | 'end';
	sideOffset?: number;
	delayDuration?: number;
}

const props = withDefaults(defineProps<Props>(), {
	side: 'bottom',
	align: 'center',
	sideOffset: 4,
	delayDuration: 200,
});

const tooltip = inject<any>('tooltip');
const triggerElement = computed(() => tooltip?.triggerElement?.value ?? null);

const isOpen = computed(() => tooltip?.isOpen.value ?? false);
const contentRef = ref<HTMLElement | null>(null);
const position = ref({ top: 0, left: 0 });

const calculatePosition = () => {
	if (!triggerElement.value || !contentRef.value) return;

	const triggerRect = triggerElement.value.getBoundingClientRect();
	const contentRect = contentRef.value.getBoundingClientRect();

	let top = 0;
	let left = 0;

	switch (props.side) {
		case 'bottom':
			top = triggerRect.bottom + props.sideOffset;
			left = triggerRect.left + triggerRect.width / 2 - contentRect.width / 2;
			break;
		case 'top':
			top = triggerRect.top - contentRect.height - props.sideOffset;
			left = triggerRect.left + triggerRect.width / 2 - contentRect.width / 2;
			break;
		case 'left':
			left = triggerRect.left - contentRect.width - props.sideOffset;
			top = triggerRect.top + triggerRect.height / 2 - contentRect.height / 2;
			break;
		case 'right':
			left = triggerRect.right + props.sideOffset;
			top = triggerRect.top + triggerRect.height / 2 - contentRect.height / 2;
			break;
	}

	position.value = { top, left };
};

watch(isOpen, async (open) => {
	if (open) {
		await nextTick();
		requestAnimationFrame(() => {
			calculatePosition();
		});
	}
});
</script>

<template>
	<Teleport to="body">
		<Transition
			name="tooltip"
			@enter="(el) => (el as HTMLElement).offsetHeight"
			@leave="(el) => (el as HTMLElement).offsetHeight"
		>
			<div
				v-show="isOpen"
				ref="contentRef"
				:style="{ position: 'fixed', top: `${position.top}px`, left: `${position.left}px`, zIndex: 50 }"
				class="pointer-events-none whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-sm text-slate-50 shadow-md"
			>
				<slot />
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
@reference "../../../assets/main.css";

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
