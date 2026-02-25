<script setup lang="ts">
</script>

<template>
  <div class="context-menu-label">
    <slot />
  </div>
</template>

<style scoped>
.context-menu-label {
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
}
</style>
