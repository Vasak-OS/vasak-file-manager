<script setup lang="ts">
interface Props {
	class?: string;
}

defineProps<Props>();
</script>

<template>
	<div
		:class="['dropdown-menu-label', $attrs.class]"
	>
		<slot />
	</div>
</template>

<style scoped>
@reference "../../../style.css";

.dropdown-menu-label {
	@apply px-3 py-2 text-sm font-semibold text-slate-900;
}
</style>
