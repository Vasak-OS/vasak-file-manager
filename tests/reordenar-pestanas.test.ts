/**
 * La cuenta que reordena las pestañas cuando se suelta uno arrastrado.
 *
 * `vue3-smooth-dnd` no mueve nada por su cuenta: avisa con un `drop` que trae
 * de dónde salió —`removedIndex`— y adónde cayó —`addedIndex`—, y la lista
 * nueva la arma esta aplicación. Los dos índices son **relativos a momentos
 * distintos**: `addedIndex` cuenta sobre la lista **ya sin** el elemento que
 * salió, así que sacar primero y después insertar no es lo mismo que insertar
 * primero y después sacar. Equivocarse ahí no da error: deja la pestaña una
 * posición corrida, y sólo en algunos sentidos del arrastre.
 *
 * Esto se escribió al subir la biblioteca de la 0.0.6 a la 1.0.0, que entre sus
 * arreglos trae justamente «Incorrect Evaluation of 'addedIndex'». La cuenta de
 * acá no compensaba nada de aquel error —es la de siempre: sacar, insertar—,
 * pero no tenía ninguna prueba que lo dijera, así que un arreglo del lado de la
 * biblioteca y una compensación escondida de este lado eran indistinguibles.
 */

import { describe, expect, test } from 'bun:test';
import { mount } from '@vue/test-utils';
import { toRaw } from 'vue';
import { Container, type DropResult } from 'vue3-smooth-dnd';
import TabDraggableComponent from '../src/components/tab/TabDraggableComponent.vue';

const LETRAS = ['a', 'b', 'c', 'd'];

/** Monta la barra y devuelve lo que emite al soltar con ese resultado. */
function soltar(resultado: Partial<DropResult>, items: unknown[] = LETRAS): unknown[] | undefined {
	const barra = mount(TabDraggableComponent, {
		props: { items, parentSelector: '.tab-bar' },
		// El contenedor va simulado. Lo que se prueba es la cuenta de esta
		// aplicación a partir de un `drop`, no el arrastre de la biblioteca —que
		// necesita un ratón de verdad y medidas de elementos que el DOM de las
		// pruebas no tiene—. Montar el de verdad costaba nueve segundos por
		// prueba, y no comprobaba nada más.
		global: { stubs: { Container: true } },
	});

	barra.findComponent(Container).vm.$emit('drop', {
		removedIndex: null,
		addedIndex: null,
		payload: undefined,
		element: document.createElement('div'),
		...resultado,
	});

	const emitidos = barra.emitted('set') as [unknown[]][] | undefined;
	return emitidos?.at(-1)?.[0];
}

describe('al soltar una pestaña arrastrada', () => {
	test('y el montaje emite de verdad', () => {
		// Sin esto, un `findComponent` que no encuentre nada —o un `set` que
		// nadie escuche— deja todas las de abajo comparando `undefined` contra
		// `undefined` y pasando.
		expect(soltar({ removedIndex: 0, addedIndex: 0 })).toEqual(LETRAS);
	});

	test('hacia la derecha queda donde se la soltó', () => {
		// La `a` cae en la posición 2 de la lista ya sin ella: b, c, a, d.
		expect(soltar({ removedIndex: 0, addedIndex: 2 })).toEqual(['b', 'c', 'a', 'd']);
	});

	test('hacia la izquierda también', () => {
		expect(soltar({ removedIndex: 3, addedIndex: 1 })).toEqual(['a', 'd', 'b', 'c']);
	});

	test('al final de todo no se pierde', () => {
		expect(soltar({ removedIndex: 1, addedIndex: 3 })).toEqual(['a', 'c', 'd', 'b']);
	});

	test('la que viene de otro lado se inserta con su carga', () => {
		// `removedIndex` en nulo es lo que manda la biblioteca cuando el
		// elemento no salió de esta lista: entonces el que se inserta es el
		// `payload`, y no hay nada que sacar.
		expect(soltar({ removedIndex: null, addedIndex: 1, payload: 'z' })).toEqual([
			'a',
			'z',
			'b',
			'c',
			'd',
		]);
	});

	test('la que se fue a otro lado sale sin dejar hueco', () => {
		expect(soltar({ removedIndex: 2, addedIndex: null })).toEqual(['a', 'b', 'd']);
	});

	test('y un arrastre que no llegó a ninguna parte devuelve la lista, no una copia', () => {
		// Los dos en nulo: se empezó a arrastrar y se soltó afuera. Devolver una
		// lista nueva acá tampoco rompería nada visible, pero haría que la
		// tienda se guarde una copia en cada arrastre fallido.
		//
		// Por eso va `toBe` y no `toEqual`: comparar los elementos deja pasar
		// justamente el `[...props.items]` que se quiere evitar. Lo marcó la
		// revisión.
		//
		// Y va con `toRaw` porque la comparación directa contra la lista que se
		// pasó falla igual: lo que el componente recibe en `props.items` es el
		// envoltorio reactivo que arma el montaje, no el arreglo de acá. `toRaw`
		// lo desenvuelve y deja la identidad comparable; una copia sigue siendo
		// ella misma y no pasa. Se comprobó devolviendo una.
		const items = [...LETRAS];

		expect(toRaw(soltar({}, items) as unknown[])).toBe(items);
	});
});
