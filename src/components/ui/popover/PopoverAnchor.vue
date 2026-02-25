<script setup lang="ts">
interface Props {
	asChild?: boolean;
}

withDefaults(defineProps<Props>(), {
	asChild: false,
});
</script>

<template>
	<div class="popover-anchor">
		<slot />
	</div>
</template>

<style scoped>
.popover-anchor {
	@apply inline-block;
}
</style>
