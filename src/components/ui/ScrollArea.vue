<script setup lang="ts">
interface Props {
	class?: string;
}

defineProps<Props>();
</script>

<template>
	<div :class="['scroll-area', $attrs.class]">
		<div class="scroll-area__viewport">
			<slot />
		</div>
		<div class="scroll-area__scrollbar scroll-area__scrollbar--vertical">
			<div class="scroll-area__thumb" />
		</div>
	</div>
</template>

<style scoped>
@reference "../../assets/main.css";

.scroll-area {
	@apply relative w-full h-full overflow-hidden;
}

.scroll-area__viewport {
	@apply w-full h-full overflow-y-auto overflow-x-hidden;
}

.scroll-area__viewport::-webkit-scrollbar {
	@apply w-2;
}

.scroll-area__viewport::-webkit-scrollbar-track {
	@apply bg-transparent;
}

.scroll-area__viewport::-webkit-scrollbar-thumb {
	@apply bg-slate-300 rounded-full hover:bg-slate-400;
}

.scroll-area__scrollbar {
	@apply absolute top-0 right-0 w-2 h-full bg-slate-100 rounded;
}

.scroll-area__scrollbar--vertical {
	@apply w-2;
}

.scroll-area__thumb {
	@apply w-full bg-slate-400 rounded;
}
</style>
