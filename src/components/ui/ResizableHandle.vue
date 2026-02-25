<script lang="ts" setup>
import { computed, defineProps, inject, withDefaults } from 'vue';

interface ResizableGroupContext {
	startDrag: (e: MouseEvent, handleIndex: number) => void;
	isHorizontal: any;
}

interface Props {
	withHandle?: boolean;
	class?: string;
}

withDefaults(defineProps<Props>(), {
	withHandle: true,
});

const resizableGroup = inject<ResizableGroupContext>('resizable-panel-group');

const handleClass = computed(() => {
	const isHorizontal = resizableGroup?.isHorizontal.value;
	const base = isHorizontal
		? 'w-1 h-full cursor-col-resize hover:bg-blue-500/20 active:bg-blue-500/30 transition-colors'
		: 'w-full h-1 cursor-row-resize hover:bg-blue-500/20 active:bg-blue-500/30 transition-colors';

	return base;
});

const barClass = computed(() => {
	const isHorizontal = resizableGroup?.isHorizontal.value;
	return isHorizontal
		? 'absolute left-1/2 top-1/2 w-1 h-8 -translate-x-1/2 -translate-y-1/2 bg-gray-400/50 rounded-sm'
		: 'absolute left-1/2 top-1/2 w-8 h-1 -translate-x-1/2 -translate-y-1/2 bg-gray-400/50 rounded-sm';
});

function handleMouseDown(e: MouseEvent) {
	resizableGroup?.startDrag(e, 0);
}
</script>

<template>
  <div :class="handleClass" @mousedown="handleMouseDown">
    <div v-if="withHandle" :class="barClass" />
  </div>
</template>
