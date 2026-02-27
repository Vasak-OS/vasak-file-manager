<script setup lang="ts">
import { computed, provide, ref } from 'vue';

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

const closeDropdown = () => {
	isOpen.value = false;
};

const toggleDropdown = () => {
	isOpen.value = !isOpen.value;
};

provide('dropdown', {
	isOpen,
	closeDropdown,
	toggleDropdown,
});
</script>

<template>
	<div class="relative inline-block background rounded-corner p-1 hover:bg-primary dark:hover:bg-primary-dark">
		<slot />
	</div>
</template>
