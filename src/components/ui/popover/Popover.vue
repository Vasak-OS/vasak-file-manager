<script setup lang="ts">
import { computed, provide, ref } from 'vue';

interface Props {
	open?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
	'update:open': [value: boolean];
}>();

const internalOpen = ref(false);
const triggerElement = ref<HTMLElement | null>(null);

const isOpen = computed({
	get: () => props.open ?? internalOpen.value,
	set: (value: boolean) => {
		if (props.open === undefined) {
			internalOpen.value = value;
		}
		emit('update:open', value);
	},
});

const togglePopover = () => {
	isOpen.value = !isOpen.value;
};

const closePopover = () => {
	isOpen.value = false;
};

const openPopover = () => {
	isOpen.value = true;
};

const setTriggerElement = (element: HTMLElement | null) => {
	triggerElement.value = element;
};

provide('popover', {
	isOpen,
	togglePopover,
	closePopover,
	openPopover,
	triggerElement,
	setTriggerElement,
});
</script>

<template>
	<div class="relative inline-block">
		<slot />
	</div>
</template>