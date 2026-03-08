<script setup lang="ts">
interface Props {
	class?: string;
}

defineProps<Props>();
</script>

<template>
	<div :class="['relative w-full h-full overflow-hidden', $attrs.class]">
		<div class="w-full h-full overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ui-bg/80 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400">
			<slot />
		</div>
		<div class="absolute top-0 right-0 w-2 h-full hover:bg-ui-bg/90 rounded">
			<div class="w-full bg-primary hover:bg-secondary rounded" />
		</div>
	</div>
</template>


