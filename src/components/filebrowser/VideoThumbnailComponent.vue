<script setup lang="ts">
/**
 * La miniatura de un video, resuelta **una vez por tarjeta**.
 *
 * `ctx.getVideoThumbnail(entry)` no es un getter barato: lee el `ref` reactivo
 * profundo de miniaturas, consulta los conjuntos de «en curso» y «fallados», y
 * cuando no hay nada cacheado encola la generación. La tarjeta de video lo
 * llamaba cinco veces por dibujado —los dos `v-if` de las capas, el `:class`
 * del marco y, adentro del marco, el `v-if` y el `:src`—; cuatro cuando la
 * miniatura todavía no está. Cada llamada repetía todo eso.
 *
 * Acá adentro es una sola lectura, memoizada, por instancia y por cambio de la
 * caché. El componente no dibuja nada: le pasa la miniatura a lo que envuelve,
 * así que la tarjeta sigue siendo el mismo marcado y no hay ningún elemento de
 * más en el DOM.
 *
 * Se resuelve con una instancia hija y no con un `computed` que recorra las
 * entradas porque la cuadrícula está **virtualizada** (`RecycleScroller`): sólo
 * existen las tarjetas visibles, y un `computed` sobre todas pediría la
 * miniatura de lo que está fuera de pantalla —generación ansiosa de ffmpeg para
 * la carpeta entera— y eso sí cambia el comportamiento.
 *
 * El marcado se queda en la vista a propósito: la guardia de diseño deja las
 * capas de las tarjetas sin transición al pasar por encima
 * (`group-hover:duration-0`) sólo en los dos archivos de vista
 * (`ENTRY_VIEWS`), así que mover la tarjeta entera a un componente propio
 * pondría roja esa guardia.
 */
import { computed } from 'vue';
import { useFileBrowserContext } from '@/composables/file-browser/use-file-browser-context';
import type { DirEntry } from '@/types/dir-entry';

const props = defineProps<{ entry: DirEntry }>();

defineSlots<{ default: (props: { thumbnail: string | undefined }) => unknown }>();

const ctx = useFileBrowserContext();

const thumbnail = computed(() => ctx.getVideoThumbnail(props.entry));
</script>

<template>
  <slot :thumbnail="thumbnail" />
</template>
