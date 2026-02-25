<script setup lang="ts">
import { inject } from 'vue';

const numberField = inject<any>('numberField');
</script>

<template>
	<input
		type="number"
		class="number-field-input"
		:value="numberField?.currentValue.value"
		:min="numberField?.min"
		:max="numberField?.max"
		@input="numberField?.handleInput(($event.target as HTMLInputElement).value)"
	/>
</template>

<style scoped>
.number-field-input {
	width: 100%;
	padding: 6px 12px;
	border: 1px solid hsl(var(--border));
	border-radius: var(--radius-sm);
	background-color: hsl(var(--background));
	color: hsl(var(--foreground));
	font-size: 13px;
	transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.number-field-input:focus {
	outline: none;
	border-color: hsl(var(--primary));
	box-shadow: 0 0 0 2px hsl(var(--primary) / 10%);
}

.number-field-input:disabled {
	background-color: hsl(var(--muted));
	opacity: 0.5;
	cursor: not-allowed;
}

/* Remove number input spinners */
.number-field-input::-webkit-outer-spin-button,
.number-field-input::-webkit-inner-spin-button {
	-webkit-appearance: none;
	margin: 0;
}

.number-field-input[type='number'] {
	-moz-appearance: textfield;
}
</style>
