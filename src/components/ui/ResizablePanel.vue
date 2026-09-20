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

const emit = defineEmits<{
	/**
	 * El botón que se apretó sobre el panel.
	 *
	 * Es lo que usa la barra del navegador para saber qué panel pasa a ser el
	 * activo en vista dividida. Antes no estaba declarado: el `@mousedown` de
	 * quien lo usa caía sobre el `<div>` de afuera por atributos, funcionaba, y
	 * no había forma de saberlo leyendo el componente. `strictTemplates` lo
	 * volvió un error.
	 *
	 * Declararlo lo saca de los atributos, así que el `@mousedown` de abajo no
	 * es opcional: sin él, hacer clic en un panel deja de enfocarlo y nada
	 * avisa.
	 */
	mousedown: [evento: MouseEvent];
}>();

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
  <div :style="panelStyle" :class="containerClass" @mousedown="emit('mousedown', $event)">
    <slot />
  </div>
</template>


