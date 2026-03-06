<script setup lang="ts">
interface Props {
	class?: string;
}

defineProps<Props>();
</script>

<template>
	<div :class="['relative w-full h-full overflow-hidden', $attrs.class]">
		<div class="w-full h-full overflow-y-auto overflow-x-hidden scroll-area__viewport">
			<slot />
		</div>
		<div class="scroll-area__scrollbar scroll-area__scrollbar--vertical">
			<div class="scroll-area__thumb" />
		</div>
	</div>
</template>

<style scoped>
@reference "../../assets/main.css";

.scroll-area__viewport::-webkit-scrollbar {
	@apply w-2;
}

.scroll-area__viewport::-webkit-scrollbar-track {
	@apply bg-transparent;
}

.scroll-area__viewport::-webkit-scrollbar-thumb {
	@apply bg-ui-bg/80 rounded-full hover:bg-slate-400;
}

.scroll-area__scrollbar {
	@apply absolute top-0 right-0 w-2 h-full hover:bg-ui-bg/90 rounded;
}

.scroll-area__scrollbar--vertical {
	@apply w-2;
}

.scroll-area__thumb {
	@apply w-full bg-primary hover:bg-secondary rounded;
}
</style>
