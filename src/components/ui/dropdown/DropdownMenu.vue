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
	<div class="dropdown-menu">
		<slot />
	</div>
</template>

<style scoped>
@reference "../../../style.css";

.dropdown-menu {
	@apply relative inline-block;
}
</style>
