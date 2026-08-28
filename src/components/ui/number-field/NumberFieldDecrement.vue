<script setup lang="ts">
import { inject } from 'vue';

const numberField = inject<any>('numberField');
</script>

<template>
	<button
		type="button"
		class="flex items-center justify-center w-8 h-8 border border-ui-border rounded-corner-sm bg-ui-bg/80 text-tx-main cursor-pointer text-lg font-medium transition-colors enabled:hover:bg-ui-surface enabled:hover:border-ui-border/80 enabled:active:bg-ui-surface/80 disabled:opacity-50 disabled:cursor-not-allowed"
		:disabled="numberField?.min !== undefined && numberField?.currentValue?.value <= numberField?.min"
		@click="numberField?.decrement()"
	>
		−
	</button>
</template>


