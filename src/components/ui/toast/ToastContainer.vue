<script lang="ts" setup>
import { computed } from 'vue';
import { useToast } from './toaster';

const { toasts } = useToast();

const toastList = computed(() => Array.from(toasts.value.values()));
</script>

<template>
  <Teleport to="body">
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <TransitionGroup
        tag="div"
        enter-active-class="transition-all duration-300 ease"
        leave-active-class="transition-all duration-300 ease"
        enter-from-class="opacity-0 translate-x-[30px]"
        leave-to-class="opacity-0 translate-x-[30px]"
        move-class="transition-transform duration-300 ease"
      >
        <div v-for="toast in toastList" :key="toast.id" class="pointer-events-auto">
          <component :is="toast.component" v-bind="toast.componentProps" />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>


