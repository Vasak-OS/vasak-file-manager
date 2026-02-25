<script setup lang="ts">
import { inject } from 'vue';

interface Props {
	asChild?: boolean;
}

withDefaults(defineProps<Props>(), {
	asChild: false,
});

const tooltip = inject<any>('tooltip');

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
</script>

<template>
	<div
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
