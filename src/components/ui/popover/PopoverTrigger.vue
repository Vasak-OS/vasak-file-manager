<script setup lang="ts">
import { inject, ref, onMounted } from 'vue';

interface Props {
	asChild?: boolean;
}

withDefaults(defineProps<Props>(), {
	asChild: false,
});

const popover = inject<any>('popover');
const triggerRef = ref<HTMLElement | null>(null);

const resolveTriggerElement = () => {
	if (!triggerRef.value) return null;
	const child = triggerRef.value.firstElementChild as HTMLElement | null;
	return child ?? triggerRef.value;
};

const handleClick = (event: MouseEvent) => {
	const element = (event.currentTarget as HTMLElement) ?? resolveTriggerElement();
	popover?.setTriggerElement?.(element);
	popover?.togglePopover();
};

onMounted(() => {
	popover?.setTriggerElement?.(resolveTriggerElement());
});
</script>

<template>
	<div
		ref="triggerRef"
		class="popover-trigger inline-block"
		@click="handleClick"
	>
		<slot />
	</div>
</template>

