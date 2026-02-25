<script setup lang="ts">
import { inject } from 'vue';

const numberField = inject<any>('numberField');
</script>

<template>
	<button
		type="button"
		class="number-field-increment"
		:disabled="numberField?.max !== undefined && numberField?.currentValue.value >= numberField?.max"
		@click="numberField?.increment()"
	>
		+
	</button>
</template>

<style scoped>
.number-field-increment {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border: 1px solid hsl(var(--border));
	border-radius: var(--radius-sm);
	background-color: hsl(var(--background));
	color: hsl(var(--foreground));
	cursor: pointer;
	font-size: 18px;
	font-weight: 500;
	transition: background-color 0.15s ease, border-color 0.15s ease;
}

.number-field-increment:hover:not(:disabled) {
	background-color: hsl(var(--muted));
	border-color: hsl(var(--border) / 80%);
}

.number-field-increment:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.number-field-increment:active:not(:disabled) {
	background-color: hsl(var(--muted) / 80%);
}
</style>
