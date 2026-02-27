<script setup lang="ts">
import { inject, ref, provide, onMounted } from 'vue';

interface Props {
	asChild?: boolean;
}

withDefaults(defineProps<Props>(), {
	asChild: false,
});

const popover = inject<any>('popover');
const triggerRef = ref<HTMLElement | null>(null);

provide('popoverTriggerElement', triggerRef);

const handleClick = () => {
	popover?.togglePopover();
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
		class="popover-trigger inline-block"
		@click="handleClick"
	>
		<slot />
	</div>
</template>

