<script setup lang="ts">
import { computed, inject, ref, watch, onMounted, onBeforeUnmount } from 'vue';

interface Props {
	side?: 'top' | 'bottom' | 'left' | 'right';
	align?: 'start' | 'center' | 'end';
	sideOffset?: number;
	class?: string;
}

const props = withDefaults(defineProps<Props>(), {
	side: 'bottom',
	align: 'center',
	sideOffset: 4,
});

const popover = inject<any>('popover');
const triggerElement = inject<any>('popoverTriggerElement');

const isOpen = computed(() => popover?.isOpen.value ?? false);
const contentRef = ref<HTMLElement | null>(null);
const position = ref({ top: 0, left: 0 });

const calculatePosition = () => {
	if (!triggerElement?.value || !contentRef.value) return;
	
	const triggerRect = triggerElement.value.getBoundingClientRect();
	const contentRect = contentRef.value.getBoundingClientRect();
	
	let top = 0;
	let left = 0;
	
	switch (props.side) {
		case 'bottom':
			top = triggerRect.bottom + props.sideOffset;
			break;
		case 'top':
			top = triggerRect.top - contentRect.height - props.sideOffset;
			break;
		case 'left':
			left = triggerRect.left - contentRect.width - props.sideOffset;
			top = triggerRect.top;
			break;
		case 'right':
			left = triggerRect.right + props.sideOffset;
			top = triggerRect.top;
			break;
	}
	
	switch (props.align) {
		case 'start':
			if (props.side === 'bottom' || props.side === 'top') {
				left = triggerRect.left;
			}
			break;
		case 'center':
			if (props.side === 'bottom' || props.side === 'top') {
				left = triggerRect.left + (triggerRect.width / 2) - (contentRect.width / 2);
			}
			break;
		case 'end':
			if (props.side === 'bottom' || props.side === 'top') {
				left = triggerRect.right - contentRect.width;
			}
			break;
	}
	
	position.value = { top, left };
};

watch(isOpen, (open) => {
	if (open) {
		setTimeout(calculatePosition, 0);
	}
});

const handleClickOutside = (event: MouseEvent) => {
	const target = event.target as HTMLElement;
	if (!target.closest('[popover-content]') && !target.closest('.popover-trigger')) {
		popover?.closePopover();
	}
};

onMounted(() => {
	document.addEventListener('click', handleClickOutside);
});

onBeforeUnmount(() => {
	document.removeEventListener('click', handleClickOutside);
});
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
				ref="contentRef"
				:class="[$attrs.class]"
				:style="{ position: 'fixed', top: `${position.top}px`, left: `${position.left}px`, zIndex: 50 }"
				popover-content
				class="rounded-md border bg-white shadow-lg"
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
