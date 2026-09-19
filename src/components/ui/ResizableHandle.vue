<script lang="ts" setup>
import { computed, inject } from 'vue';

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

/**
 * El tirador, que es el aire entre las dos tarjetas.
 *
 * No pinta ninguna línea: cada panel es su propia tarjeta, con su borde y su
 * fondo, y dos tarjetas separadas ya dicen dónde termina una y empieza la otra
 * mejor que una raya adentro de un panel único. Lo que aporta esto es el hueco
 * —y el poder arrastrarlo—.
 *
 * El hueco mide lo mismo que separa a todo lo demás en el escritorio: el `p-1`
 * y el `gap-1` que la ventana usa entre la barra lateral, el contenido y el
 * panel de información. Un hueco más ancho acá hacía que la división se leyera
 * como otra cosa que el resto de las separaciones de la misma ventana.
 *
 * `relative` porque la manija de adentro va posicionada contra él; sin eso se
 * colocaba contra el primer ancestro posicionado que hubiera, que no es éste.
 *
 * `self-stretch` y no `h-full`: la fila de paneles no tiene alto definido, así
 * que `height: 100%` se resolvía en `auto` y, en un div vacío, eso es **cero**.
 * El tirador ocupaba su ancho —los paneles se corrían— pero no pintaba nada, y
 * por eso ponerle un color no cambiaba nada. Se vio pintándolo de rojo.
 */
const handleClass = computed(() => {
	const isHorizontal = resizableGroup?.isHorizontal.value;
	const base = isHorizontal
		? 'relative shrink-0 w-1 self-stretch cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors'
		: 'relative shrink-0 h-1 self-stretch cursor-row-resize hover:bg-primary/20 active:bg-primary/30 transition-colors';

	return base;
});

const barClass = computed(() => {
	const isHorizontal = resizableGroup?.isHorizontal.value;
	return isHorizontal
		? 'absolute left-1/2 top-1/2 w-1 h-8 -translate-x-1/2 -translate-y-1/2 bg-tx-muted/50 rounded-corner-sm'
		: 'absolute left-1/2 top-1/2 w-8 h-1 -translate-x-1/2 -translate-y-1/2 bg-tx-muted/50 rounded-corner-sm';
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
