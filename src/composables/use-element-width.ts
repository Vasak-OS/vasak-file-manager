/**
 * El ancho de un elemento, al día.
 *
 * Para lo que cambia de **contenido** con el lugar que le dan —un botón que
 * pierde el texto y queda con el icono— y no se puede decir con una consulta de
 * contenedor porque el texto es una propiedad de un componente
 * (`ActionButton`), no un elemento que se pueda esconder. Va con
 * `ResizeObserver` porque en WebKitGTK ni `matchMedia` ni `resize` avisan.
 *
 * Hasta la primera medida vale infinito: sin saber el ancho, se dibuja el
 * formato de siempre, el ancho.
 */
import { onBeforeUnmount, type Ref, ref, watch } from 'vue';

export function useElementWidth(element: Ref<HTMLElement | null>): Ref<number> {
	const width = ref(Number.POSITIVE_INFINITY);
	let observer: ResizeObserver | null = null;

	watch(
		element,
		(current) => {
			observer?.disconnect();
			observer = null;
			if (!current || typeof ResizeObserver === 'undefined') return;
			observer = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (entry) width.value = entry.contentRect.width;
			});
			observer.observe(current);
		},
		{ flush: 'post' }
	);

	onBeforeUnmount(() => observer?.disconnect());

	return width;
}
