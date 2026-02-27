<script setup lang="ts">
import { inject, ref, provide, onMounted } from 'vue';

interface Props {
	asChild?: boolean;
}

withDefaults(defineProps<Props>(), {
	asChild: false,
});

const tooltip = inject<any>('tooltip');
const triggerRef = ref<HTMLElement | null>(null);

provide('tooltipTriggerElement', triggerRef);

const handleMouseEnter = () => {
	tooltip?.open();
};

const handleMouseLeave = () => {
	tooltip?.close();
};

const handleFocus = () => {
	tooltip?.open();
};

const handleBlur = () => {
	tooltip?.close();
};

onMounted(() => {
	if (triggerRef.value) {
		const child = triggerRef.value.firstElementChild as HTMLElement;
		if (child) {
			triggerRef.value = child;
		}
	}
});
</script>

<template>
	<div
		ref="triggerRef"
		class="tooltip-trigger"
		@mouseenter="handleMouseEnter"
		@mouseleave="handleMouseLeave"
		@focus="handleFocus"
		@blur="handleBlur"
	>
		<slot />
	</div>
</template>

<style scoped>
.tooltip-trigger {
	@apply inline-block;
}
</style>
