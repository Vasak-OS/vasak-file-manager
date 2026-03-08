<script setup lang="ts">
import { inject } from 'vue';

const numberField = inject<any>('numberField');
</script>

<template>
	<button
		type="button"
		class="flex items-center justify-center w-8 h-8 border border-ui-border rounded-sm bg-background text-foreground cursor-pointer text-lg font-medium transition-colors enabled:hover:bg-muted enabled:hover:border-ui-border/80 enabled:active:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
		:disabled="numberField?.max !== undefined && numberField?.currentValue?.value >= numberField?.max"
		@click="numberField?.increment()"
	>
		+
	</button>
</template>


