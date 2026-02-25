<script lang="ts" setup>
import { computed, defineProps, provide, ref } from 'vue';

interface Panel {
	id: string;
	size: number;
	minSize: number;
}

interface Props {
	direction?: 'horizontal' | 'vertical';
	class?: string;
}

const props = withDefaults(defineProps<Props>(), {
	direction: 'horizontal',
});

const panels = ref<Map<string, Panel>>(new Map());
const isDragging = ref(false);
const dragStartX = ref(0);
const dragStartY = ref(0);
const dragStartSizes = ref<{ [key: string]: number }>({});

const isHorizontal = computed(() => props.direction === 'horizontal');

const containerClass = computed(() => {
	const base = `flex ${isHorizontal.value ? 'flex-row' : 'flex-col'} w-full h-full`;
	return `${base} ${props.class || ''}`;
});

function registerPanel(id: string, minSize: number = 0) {
	if (!panels.value.has(id)) {
		panels.value.set(id, {
			id,
			size: 0,
			minSize,
		});
	}
}

function unregisterPanel(id: string) {
	panels.value.delete(id);
}

function resizeTo(panelId: string, sizePercent: number) {
	const panel = panels.value.get(panelId);
	if (panel) {
		panel.size = Math.max(panel.minSize, sizePercent);
	}
}

function startDrag(e: MouseEvent, handleIndex: number) {
	isDragging.value = true;
	dragStartX.value = e.clientX;
	dragStartY.value = e.clientY;

	// Store initial sizes
	const panelIds = Array.from(panels.value.keys());
	dragStartSizes.value = {};
	panelIds.forEach((id) => {
		dragStartSizes.value[id] = panels.value.get(id)?.size || 0;
	});

	document.addEventListener('mousemove', handleDrag);
	document.addEventListener('mouseup', stopDrag);
	document.body.style.userSelect = 'none';
}

function handleDrag(e: MouseEvent) {
	if (!isDragging.value) return;

	const panelIds = Array.from(panels.value.keys());
	if (panelIds.length < 2) return;

	const deltaX = e.clientX - dragStartX.value;
	const deltaY = e.clientY - dragStartY.value;
	const delta = isHorizontal.value ? deltaX : deltaY;

	// Get container dimensions
	const container = document.querySelector('[data-resizable-panel-group]') as HTMLElement;
	if (!container) return;

	const containerSize = isHorizontal.value ? container.clientWidth : container.clientHeight;
	const deltaPercent = (delta / containerSize) * 100;

	// Resize first two panels
	const panel1 = panels.value.get(panelIds[0]);
	const panel2 = panels.value.get(panelIds[1]);

	if (panel1 && panel2) {
		const newSize1 = Math.max(panel1.minSize, dragStartSizes.value[panelIds[0]] + deltaPercent);
		const newSize2 = Math.max(panel2.minSize, dragStartSizes.value[panelIds[1]] - deltaPercent);

		const totalNeeded = newSize1 + newSize2;
		if (totalNeeded <= 100) {
			panel1.size = newSize1;
			panel2.size = newSize2;
		}
	}
}

function stopDrag() {
	isDragging.value = false;
	document.removeEventListener('mousemove', handleDrag);
	document.removeEventListener('mouseup', stopDrag);
	document.body.style.userSelect = '';
}

// Provide methods for child components
provide('resizable-panel-group', {
	registerPanel,
	unregisterPanel,
	resizeTo,
	startDrag,
	isHorizontal,
	isDragging,
	panels,
});
</script>

<template>
  <div :class="containerClass" data-resizable-panel-group>
    <slot />
  </div>
</template>

<style scoped>
</style>
