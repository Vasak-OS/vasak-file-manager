/**
 * Quién desplaza la lista.
 *
 * La lista está virtualizada con `vue-virtual-scroller`, y ese desplazador
 * tiene dos modos. Por omisión se hace cargo él: se pone `overflow-y: auto` y
 * dibuja su propia barra. En **modo página** no: mide contra el elemento que
 * desplaza más arriba —acá el `ScrollArea` que envuelve la vista— y deja que
 * desplace ése. Es lo que hace también la cuadrícula.
 *
 * Esta aplicación quiere el segundo. Con el primero quedan dos barras, una
 * adentro de la otra: la del tema en el borde de la ventana y la del
 * desplazador adentro de la lista, con el hueco que
 * `--file-browser-list-right-gutter` reserva para la primera quedando vacío.
 *
 * Pasó: el atributo se sacó leyendo las propiedades que `DynamicScroller`
 * declara, que no lo incluyen. Pero su plantilla hace `v-bind="$attrs"` sobre
 * el `RecycleScroller` de adentro, que sí lo declara, así que el atributo
 * llegaba igual. Lo único que se veía desde el código era que `vue-tsc` no lo
 * conocía.
 *
 * De ahí estas pruebas: la clase `page-mode` del elemento es lo que distingue
 * un modo del otro, y es lo que hay que mirar para no volver a sacarlo.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, defineComponent, h, ref } from 'vue';
import {
	type FileBrowserContext,
	provideFileBrowserContext,
} from '@/composables/file-browser/use-file-browser-context';
import type { DirEntry } from '@/types/dir-entry';
import FileBrowserListView from '@/views/filebrowser/FileBrowserListView.vue';
import { olvidarTodo } from './dobles';

const entrada = (name: string): DirEntry =>
	({ name, path: `/casa/${name}`, is_dir: false, is_file: true, size: 10 }) as DirEntry;

const entradas = Array.from({ length: 40 }, (_, i) => entrada(`archivo-${i}`));

/** El contexto que la vista pide, con lo justo para que monte. */
function contextoMinimo(): FileBrowserContext {
	return {
		entries: computed(() => entradas),
		currentPath: computed(() => '/casa'),
		isLoading: ref(false),
		isDirectoryEmpty: computed(() => false),
		error: ref(null),
		selectedEntries: ref([]),
		isEntrySelected: () => false,
		contextMenu: ref({
			visible: false,
			x: 0,
			y: 0,
			entry: null,
		}) as FileBrowserContext['contextMenu'],
		getVideoThumbnail: () => undefined,
		setEntriesContainerRef: () => {},
		registrarSeccionesVisuales: () => {},
		registrarDesplazamiento: () => {},
		onEntryMouseDown: () => {},
		onEntryMouseUp: () => {},
		openEntryContextMenu: () => {},
		onContextMenuAction: () => {},
		openOpenWithDialog: () => {},
		navigateToHome: () => {},
	};
}

/** La vista con su contexto puesto, como la monta el navegador. */
function montarLista() {
	const anfitrion = defineComponent({
		setup() {
			provideFileBrowserContext(contextoMinimo());
			return () => h(FileBrowserListView, { entries: entradas });
		},
	});

	return mount(anfitrion, { attachTo: document.body });
}

/**
 * Un alto de verdad para todo lo que se mida.
 *
 * En modo página el desplazador decide qué filas dibujar comparando su
 * rectángulo con el alto de la ventana, y en el DOM de las pruebas todo mide
 * cero: sin esto no dibuja ninguna fila y la última prueba no tendría nada que
 * mirar.
 */
function conAltoDeVentana(alto: number) {
	const rectangulo = Element.prototype.getBoundingClientRect;
	// Se guarda el descriptor y no el número: `innerHeight` puede ser un
	// captador del prototipo, y volver a ponerle el valor viejo dejaría un dato
	// propio donde no lo había. Sin restaurarlo, el 800 queda puesto para todo
	// lo que corra después en el mismo proceso —comprobado con una prueba
	// suelta en otro archivo, que lo veía—. Lo marcó la revisión.
	const descriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
	Object.defineProperty(window, 'innerHeight', { value: alto, configurable: true });
	Element.prototype.getBoundingClientRect = () =>
		({
			top: 0,
			left: 0,
			bottom: alto,
			right: 900,
			width: 900,
			height: alto,
			x: 0,
			y: 0,
		}) as DOMRect;
	return () => {
		Element.prototype.getBoundingClientRect = rectangulo;
		if (descriptor) Object.defineProperty(window, 'innerHeight', descriptor);
		else Reflect.deleteProperty(window, 'innerHeight');
	};
}

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
});

describe('el desplazador de la lista', () => {
	test('está en modo página: desplaza el `ScrollArea`, no él', () => {
		const vista = montarLista();

		try {
			const desplazador = vista.get('.vue-recycle-scroller');

			expect(desplazador.classes()).toContain('page-mode');
		} finally {
			vista.unmount();
		}
	});

	test('y esa clase es la que apaga el `overflow` de la librería', async () => {
		// La prueba de arriba mira una clase; ésta comprueba que esa clase siga
		// siendo la que manda. La hoja de `vue-virtual-scroller` le pone
		// `overflow-y: auto` al desplazador **salvo** en modo página, y esa
		// regla es toda la diferencia entre una barra y dos. Si la librería la
		// renombra o la saca, mirar la clase dejaría de querer decir nada.
		//
		// Se lee la hoja instalada y no el estilo calculado: el CSS de la
		// librería no se carga en las pruebas, y cargarlo no haría que
		// happy-dom resolviera un `:not()` de todos modos.
		const hoja = await Bun.file(
			new URL('../node_modules/vue-virtual-scroller/dist/vue-virtual-scroller.css', import.meta.url)
		).text();

		// Con una expresión y no con el texto exacto: la librería puede juntar la
		// regla con otras en una lista de selectores, o sumarle propiedades, sin
		// cambiar lo que hace. Lo que tiene que seguir siendo cierto es que el
		// `overflow` del desplazador vertical esté condicionado a **no** estar en
		// modo página. Lo marcó la revisión.
		expect(hoja.replace(/\s+/g, '')).toMatch(
			/\.vue-recycle-scroller[^{]*\.direction-vertical:not\(\.page-mode\)[^{]*\{[^}]*overflow-y:auto/
		);
	});

	test('y la lista dibuja sus filas', async () => {
		// Que el modo esté puesto no sirve de nada si la vista no llega a
		// dibujar: sin esto las dos de arriba podrían pasar sobre un desplazador
		// vacío.
		const restaurar = conAltoDeVentana(800);
		// El montaje va adentro del `try`: si revienta, el alto falso tiene que
		// irse igual.
		let vista: ReturnType<typeof montarLista> | null = null;

		try {
			vista = montarLista();
			await vista.vm.$nextTick();
			await new Promise((sigue) => setTimeout(sigue, 0));
			await vista.vm.$nextTick();

			expect(vista.findAll('[data-entry-path]').length).toBeGreaterThan(0);
			expect(vista.text()).toContain('archivo-0');
		} finally {
			vista?.unmount();
			restaurar();
		}
	});
});
