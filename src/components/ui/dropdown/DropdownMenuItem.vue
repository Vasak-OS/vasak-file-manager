<script setup lang="ts">
import { inject } from 'vue';

interface Props {
	disabled?: boolean;
	class?: string;
}

const props = withDefaults(defineProps<Props>(), {
	disabled: false,
});

const emit = defineEmits<{
	select: [];
}>();

const dropdown = inject<any>('dropdown');

const handleClick = () => {
	if (props.disabled) return;
	emit('select');
	dropdown?.closeDropdown();
};
</script>

<template>
	<div
		:class="[
			'dropdown-menu-item',
			{
				'opacity-50 cursor-not-allowed': disabled,
				'cursor-pointer hover:bg-slate-100': !disabled,
			},
			$attrs.class,
		]"
		@click="handleClick"
	>
		<slot />
	</div>
</template>

<style scoped>
@reference "../../../style.css";

.dropdown-menu-item {
	@apply px-3 py-2 text-sm transition-colors;
}
</style>
