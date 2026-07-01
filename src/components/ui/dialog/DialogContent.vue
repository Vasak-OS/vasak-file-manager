<script setup lang="ts">
import { computed, inject, onUnmounted, ref, type WritableComputedRef, watch } from 'vue';

interface Props {
	class?: string;
}

const props = defineProps<Props>();

const dialogOpen = inject<WritableComputedRef<boolean>>('dialogOpen');
const setDialogOpen = inject<(value: boolean) => void>('setDialogOpen');
const isOpen = computed(() => dialogOpen?.value ?? false);

const contentRef = ref<HTMLDivElement | null>(null);

function closeDialog() {
	setDialogOpen?.(false);
}

function handleOverlayClick(event: MouseEvent) {
	if (event.target === event.currentTarget) {
		closeDialog();
	}
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape') {
		closeDialog();
	}
}

watch(isOpen, (value) => {
	if (value) {
		document.addEventListener('keydown', handleKeydown);
	} else {
		document.removeEventListener('keydown', handleKeydown);
	}
});

onUnmounted(() => {
	document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex items-center justify-center"
        @click="handleOverlayClick"
      >
        <div class="absolute inset-0 bg-black/40"></div>
        <div
          ref="contentRef"
          :class="[props.class, 'relative z-10 w-full max-w-lg rounded-corner border border-ui-border bg-ui-bg/80 p-6 text-tx-main shadow-lg']"
          role="dialog"
          aria-modal="true"
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.dialog-enter-active {
  transition: opacity 0.2s ease-out;
}
.dialog-leave-active {
  transition: opacity 0.15s ease-in;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
