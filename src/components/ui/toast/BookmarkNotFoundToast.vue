<script lang="ts" setup>
interface Props {
	path: string;
	onRemove?: () => void;
}

const props = defineProps<Props>();

function handleRemove() {
	if (props.onRemove) {
		props.onRemove();
	}
}
</script>

<template>
  <div class="flex items-start gap-3 w-full max-w-md p-4 rounded-corner bg-ui-bg/80 border border-status-warning/40">
    <!-- Icon -->
    <div class="flex-shrink-0 w-5 h-5 rounded-full bg-status-warning/20 flex items-center justify-center mt-0.5">
      <svg class="w-3 h-3 text-status-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5Z" />
      </svg>
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <h3 class="font-semibold text-sm text-tx-main">Ubicación no encontrada</h3>
      <p class="text-xs text-tx-muted mt-1 truncate">{{ path }}</p>
      <button
        class="mt-2 text-xs text-status-warning hover:text-status-warning/80 underline cursor-pointer"
        @click="handleRemove"
      >
        Eliminar marcador
      </button>
    </div>
  </div>
</template>
