<script setup lang="ts">
import { computed, provide, type WritableComputedRef } from 'vue';

const props = defineProps<{
	open?: boolean;
}>();

const emit = defineEmits<{
	'update:open': [value: boolean];
}>();

const dialogOpen = computed({
	get: () => props.open ?? false,
	set: (value) => emit('update:open', value),
});

provide<WritableComputedRef<boolean>>('dialogOpen', dialogOpen);
provide('setDialogOpen', (value: boolean) => emit('update:open', value));
</script>

<template>
  <div class="relative">
    <slot />
  </div>
</template>
