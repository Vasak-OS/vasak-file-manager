<script setup lang="ts">
import { inject } from 'vue';

interface Props {
	asChild?: boolean;
}

withDefaults(defineProps<Props>(), {
	asChild: false,
});

const popover = inject<any>('popover');

const handleClick = () => {
	popover?.togglePopover();
};
</script>

<template>
	<div
		class="popover-trigger"
		@click="handleClick"
	>
		<slot />
	</div>
</template>

<style scoped>
.popover-trigger {
	@apply inline-block;
}
</style>
