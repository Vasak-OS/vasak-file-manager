<script lang="ts" setup>
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';

interface ResizableGroupContext {
	registerPanel: (id: string, minSize: number) => void;
	unregisterPanel: (id: string) => void;
	resizeTo: (id: string, size: number) => void;
	panels: any;
	isHorizontal: any;
	isDragging: any;
}

interface Props {
	defaultSize?: number;
	minSize?: number;
	maxSize?: number;
	class?: string;
}

const props = withDefaults(defineProps<Props>(), {
	defaultSize: 50,
	minSize: 15,
	maxSize: 100,
});

const panelId = ref(`panel-${Math.random().toString(36).substr(2, 9)}`);

const resizableGroup = inject<ResizableGroupContext>('resizable-panel-group');

const panelStyle = computed(() => {
	if (!resizableGroup?.panels.value.has(panelId.value)) {
		// First render - use defaultSize
		return {
			flex: `0 0 ${props.defaultSize}%`,
		};
	}

	const panel = resizableGroup.panels.value.get(panelId.value);
	const size = panel?.size || props.defaultSize;

	return {
		flex: `0 0 ${size}%`,
	};
});

const containerClass = computed(() => {
	const base = 'h-full overflow-hidden min-w-0';
	return `${base} ${props.class || ''}`;
});

onMounted(() => {
	if (resizableGroup) {
		resizableGroup.registerPanel(panelId.value, props.minSize);
	}
});

onUnmounted(() => {
	if (resizableGroup) {
		resizableGroup.unregisterPanel(panelId.value);
	}
});
</script>

<template>
  <div :style="panelStyle" :class="containerClass">
    <slot />
  </div>
</template>


