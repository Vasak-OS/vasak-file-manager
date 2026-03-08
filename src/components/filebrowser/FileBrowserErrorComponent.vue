<script setup lang="ts">
defineProps<{
	error: string;
}>();

defineEmits<{
	goHome: [];
}>();
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center text-destructive gap-4">
    <AlertCircleIcon :size="32" />
    <span>{{ error }}</span>
    <button type="button" class="rounded border border-ui-border bg-secondary text-secondary-foreground px-3 py-1.5 text-xs leading-[1.2] cursor-pointer hover:bg-secondary/90" @click="$emit('goHome')">
      'fileBrowser.goHome'
    </button>
  </div>
</template>
