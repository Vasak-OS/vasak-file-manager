<script setup lang="ts">
import { computed, provide } from 'vue';

interface Props {
	open?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
	'update:open': [value: boolean];
}>();

const isOpen = computed({
	get: () => props.open ?? false,
	set: (value: boolean) => {
		emit('update:open', value);
	},
});

const togglePopover = () => {
	isOpen.value = !isOpen.value;
};

const closePopover = () => {
	isOpen.value = false;
};

const openPopover = () => {
	isOpen.value = true;
};

provide('popover', {
	isOpen,
	togglePopover,
	closePopover,
	openPopover,
});
</script>

<template>
	<div class="popover">
		<slot />
	</div>
</template>

<style scoped>
.popover {
	@apply relative inline-block;
}
</style>
