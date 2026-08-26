<script setup lang="ts">
/** biome-ignore-all lint/style/useVueMultiWordComponentNames: la regla existe para
 * que el nombre de un componente no choque con un elemento HTML. Ninguno de estos
 * lo es, y renombrarlo obligaría a tocar cada uso sin ganar nada. */
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