<script setup lang="ts">
interface Props {
	asChild?: boolean;
}

withDefaults(defineProps<Props>(), {
	asChild: false,
});
</script>

<template>
	<div class="inline-block">
		<slot />
	</div>
</template>
