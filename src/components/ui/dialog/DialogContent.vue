<script setup lang="ts">
import { inject, onUnmounted, ref, type WritableComputedRef, watch } from 'vue';

const dialogOpen = inject<WritableComputedRef<boolean>>('dialogOpen');
const setDialogOpen = inject<(value: boolean) => void>('setDialogOpen');

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

watch(dialogOpen, (value) => {
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
    <div
      v-if="dialogOpen?.value"
      class="fixed inset-0 z-50 flex items-center justify-center"
      @click="handleOverlayClick"
    >
      <div class="absolute inset-0 bg-black/40"></div>
      <div
        ref="contentRef"
        class="relative z-10 w-full max-w-lg rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-6 text-[hsl(var(--popover-foreground))] shadow-lg"
        role="dialog"
        aria-modal="true"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
