<script setup lang="ts">
import { provide, ref } from 'vue';

interface Props {
	modelValue: number;
	min?: number;
	max?: number;
	step?: number;
	class?: string;
}

const props = withDefaults(defineProps<Props>(), {
	step: 1,
});

const emit = defineEmits<{
	'update:modelValue': [value: number];
}>();

const currentValue = ref(props.modelValue);

const increment = () => {
	let newValue = currentValue.value + (props.step ?? 1);
	if (props.max !== undefined) {
		newValue = Math.min(newValue, props.max);
	}
	currentValue.value = newValue;
	emit('update:modelValue', newValue);
};

const decrement = () => {
	let newValue = currentValue.value - (props.step ?? 1);
	if (props.min !== undefined) {
		newValue = Math.max(newValue, props.min);
	}
	currentValue.value = newValue;
	emit('update:modelValue', newValue);
};

const handleInput = (value: string) => {
	let newValue = Number(value);

	if (props.min !== undefined) {
		newValue = Math.max(newValue, props.min);
	}
	if (props.max !== undefined) {
		newValue = Math.min(newValue, props.max);
	}

	currentValue.value = newValue;
	emit('update:modelValue', newValue);
};

provide('numberField', {
	currentValue,
	increment,
	decrement,
	handleInput,
	min: props.min,
	max: props.max,
});
</script>

<template>
	<div class="flex flex-col gap-1" :class="props.class">
		<slot />
	</div>
</template>


