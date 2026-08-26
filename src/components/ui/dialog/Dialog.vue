<script setup lang="ts">
/** biome-ignore-all lint/style/useVueMultiWordComponentNames: la regla existe para
 * que el nombre de un componente no choque con un elemento HTML. Ninguno de estos
 * lo es, y renombrarlo obligaría a tocar cada uso sin ganar nada. */
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
