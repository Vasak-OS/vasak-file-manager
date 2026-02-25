<script lang="ts" setup>
import { computed } from 'vue';
import { useToast } from './toaster';

const { toasts } = useToast();

const toastList = computed(() => Array.from(toasts.value.values()));
</script>

<template>
  <Teleport to="body">
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <TransitionGroup name="toast" tag="div">
        <div v-for="toast in toastList" :key="toast.id" class="pointer-events-auto">
          <component :is="toast.component" v-bind="toast.componentProps" />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
	transition: all 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
	opacity: 0;
	transform: translateX(30px);
}

.toast-move {
	transition: transform 0.3s ease;
}
</style>
