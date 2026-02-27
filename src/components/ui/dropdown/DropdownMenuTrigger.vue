<script setup lang="ts">
import { inject, ref, provide, onMounted } from 'vue';

interface Props {
	asChild?: boolean;
	disabled?: boolean;
}

withDefaults(defineProps<Props>(), {
	asChild: false,
	disabled: false,
});

const dropdown = inject<any>('dropdown');
const triggerRef = ref<HTMLElement | null>(null);

provide('dropdownTriggerElement', triggerRef);

const handleClick = () => {
	dropdown?.toggleDropdown();
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
