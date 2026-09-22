<script setup lang="ts">
/**
 * El icono de una entrada del listado.
 *
 * Es el único icono del gestor cuyo **nombre** depende del tema: sale de
 * recorrer la cadena que arma GIO para el tipo de contenido y quedarse con el
 * primero que el tema tenga. Por eso no alcanza con `ThemeIcon`, que sabe
 * recargar la imagen de un nombre al cambiar el tema pero no que el nombre
 * mismo puede dejar de ser el que corresponde: un tema con más iconos dibujaría
 * los genéricos del anterior.
 *
 * `usarLaVersionDelTema` es el enganche que la librería expone justamente para
 * esto. Lo que queda de la copia propia —descartar la respuesta que llega
 * tarde, memorizar por nombre, compartir el pedido en vuelo, recargar antes lo
 * que está en pantalla— lo hace `ThemeIcon`.
 */
import { ThemeIcon, usarLaVersionDelTema } from '@vasakgroup/vue-libvasak';
import { ref, watch } from 'vue';
import type { DirEntry } from '@/types/dir-entry';
import { GENERICO, nombreDeIcono, olvidarNombresUnaVezPor } from '@/utils/iconos-de-entrada';

const props = withDefaults(defineProps<{ entry: DirEntry; size?: number }>(), { size: 24 });

const version = usarLaVersionDelTema();
const nombre = ref(GENERICO);

/**
 * Cuál es el pedido que vale.
 *
 * Al cambiar el tema se dispara uno nuevo sin cancelar el anterior, y el
 * anterior puede contestar último: sin esta comparación escribiría el nombre
 * del tema viejo encima del nuevo, y ahí se queda hasta el siguiente cambio.
 */
let ultimoPedido = 0;

watch(
	[() => props.entry, version],
	async ([entrada, actual]) => {
		olvidarNombresUnaVezPor(actual);
		const mio = ++ultimoPedido;
		const resuelto = await nombreDeIcono(entrada).catch(() => GENERICO);
		if (mio === ultimoPedido) nombre.value = resuelto;
	},
	{ immediate: true }
);
</script>

<template>
  <ThemeIcon :name="nombre" :size="props.size" :alt="props.entry.name" />
</template>
