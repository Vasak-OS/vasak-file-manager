<script setup lang="ts">
import { inject } from 'vue';

interface Props {
	asChild?: boolean;
	disabled?: boolean;
}

withDefaults(defineProps<Props>(), {
	asChild: false,
	disabled: false,
});

const dropdown = inject<any>('dropdown');

const handleClick = () => {
	dropdown?.toggleDropdown();
};
</script>

<template>
	<div
		class="dropdown-menu-trigger"
		@click="handleClick"
	>
		<slot />
	</div>
</template>

<style scoped>
@reference "../../../style.css";

.dropdown-menu-trigger {
	@apply inline-block;
}
</style>
