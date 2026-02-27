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
	align: 'start',
	sideOffset: 4,
});

const dropdown = inject<any>('dropdown');
const triggerElement = inject<any>('dropdownTriggerElement');

const isOpen = computed(() => dropdown?.isOpen.value ?? false);
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
	if (!target.closest('[dropdown-content]') && !target.closest('.dropdown-menu-trigger')) {
		dropdown?.closeDropdown();
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
			name="dropdown"
			@enter="(el) => el.offsetHeight"
			@leave="(el) => el.offsetHeight"
		>
			<div
				v-show="isOpen"
				ref="contentRef"
				:class="[$attrs.class]"
				:style="{ position: 'fixed', top: `${position.top}px`, left: `${position.left}px`, zIndex: 50 }"
				dropdown-content
				class="min-w-[160px] rounded-corner border background shadow-lg"
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
