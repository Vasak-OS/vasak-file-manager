<script lang="ts" setup>
interface Props {
	title: string;
	description?: string;
}

defineProps<Props>();
</script>

<template>
  <div class="flex items-start gap-3 w-full max-w-md p-4 rounded-lg bg-slate-950 border border-slate-800">
    <!-- Icon -->
    <div class="flex-shrink-0 w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center mt-0.5">
      <svg class="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <h3 class="font-semibold text-sm text-white">{{ title }}</h3>
      <p v-if="description" class="text-xs text-slate-400 mt-1">{{ description }}</p>
    </div>
  </div>
</template>
