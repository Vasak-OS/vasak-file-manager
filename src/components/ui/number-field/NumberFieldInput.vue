<script setup lang="ts">
import { inject } from 'vue';

const numberField = inject<any>('numberField');
</script>

<template>
	<input
		type="number"
		class="w-full px-3 py-1.5 border border-ui-border rounded-corner-sm bg-ui-bg/80 text-tx-main text-[13px] transition-all focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:bg-ui-surface disabled:opacity-50 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-inner-spin-button]:m-0"
		:value="numberField?.currentValue?.value"
		:min="numberField?.min"
		:max="numberField?.max"
		@input="numberField?.handleInput(($event.target as HTMLInputElement).value)"
	/>
</template>


