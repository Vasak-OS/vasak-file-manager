<script setup lang="ts">
defineProps<{
	error: string;
}>();

defineEmits<{
	goHome: [];
}>();
</script>

<template>
  <div class="file-browser-error">
    <AlertCircleIcon :size="32" />
    <span>{{ error }}</span>
    <button type="button" class="file-browser-error__button" @click="$emit('goHome')">
      'fileBrowser.goHome'
    </button>
  </div>
</template>

<style scoped>
.file-browser-error {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: hsl(var(--destructive));
  gap: 16px;
}

.file-browser-error__button {
  border-radius: var(--radius);
  border: 1px solid hsl(var(--border));
  background-color: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
  padding: 6px 12px;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
}

.file-browser-error__button:hover {
  background-color: hsl(var(--secondary) / 0.9);
}
</style>