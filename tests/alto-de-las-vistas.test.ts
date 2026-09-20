/**
 * Quién decide cuánto alto tienen la lista y la cuadrícula.
 *
 * Las dos lo decían con un número: `calc(100vh - 210px)` una y
 * `calc(100vh - 144px)` la otra. O sea el alto de la ventana menos lo que
 * alguien contó a mano que ocupa lo de alrededor —la barra de la ventana, la de
 * pestañas, la de ruta, los títulos de columna, la de estado—. Esa cuenta deja
 * de ser cierta en cuanto algo de eso cambia: la barra de la ventana puesta a
 * un costado, la de ruta que desaparece en vista dividida porque cada panel
 * trae la suya, o el navegador embebido sin barra de estado. Y no avisa: la
 * vista simplemente pide un alto que no tiene que ver con el lugar donde está.
 *
 * El número no estaba porque sí. La cadena de altos se cortaba en los dos
 * envoltorios de la barra del navegador —`navigator-page__panes-wrapper` y
 * `…-container`—, que llevan sólo el nombre: no hay ninguna regla en la hoja
 * que los toque, así que eran bloques de alto automático. Todo lo de abajo pide
 * su alto con `h-full`, y contra un `auto` eso vuelve a ser `auto`: el que
 * desplaza crecía hasta su contenido y se quedaba sin nada que desplazar. El
 * comentario que traía la cuadrícula lo decía medido, 448,835 px.
 *
 * Arreglada la cadena, el número sobra. Lo que estas pruebas cuidan es que no
 * vuelva ninguna de las dos mitades: ni el número en las vistas, ni el corte en
 * los envoltorios.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, ref } from 'vue';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import {
	FILE_BROWSER_CONTEXT_KEY,
	type FileBrowserContext,
} from '@/composables/file-browser/use-file-browser-context';
import type { DirEntry } from '@/types/dir-entry';
import FileBrowserGridView from '@/views/filebrowser/FileBrowserGridView.vue';
import FileBrowserListView from '@/views/filebrowser/FileBrowserListView.vue';
import { olvidarTodo, responder } from './dobles';

const entradas = Array.from(
	{ length: 6 },
	(_, i) =>
		({
			name: `archivo-${i}`,
			path: `/casa/archivo-${i}`,
			is_dir: false,
			is_file: true,
			size: 10,
		}) as DirEntry
);

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

/**
 * Una de las dos vistas, con el contexto que pide.
 *
 * Se monta la vista directamente y el contexto va por `global.provide`, en vez
 * de envolverla en un componente que lo provea: con el envoltorio, el elemento
 * del `wrapper` es el que arma `@vue/test-utils` y no tiene ninguna clase, así
 * que mirar ahí el alto de la raíz daba siempre vacío —esta prueba pasaba con
 * un `h-[420px]` puesto—.
 */
function montarVista(vista: typeof FileBrowserListView | typeof FileBrowserGridView) {
	return mount(vista, {
		props: { entries: entradas },
		global: { provide: { [FILE_BROWSER_CONTEXT_KEY as symbol]: contextoMinimo() } },
	});
}

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	// La vista de lista lee los tamaños de carpeta, y ese store pregunta al
	// arrancar qué cálculos quedaron en curso. Sin respuesta le llega
	// `undefined` y revienta contando, lo cual no tiene nada que ver con lo que
	// se prueba acá pero tumba la prueba igual.
	responder('get_active_calculations', []);
});

describe('las vistas de entradas', () => {
	test.each([
		['la lista', FileBrowserListView],
		['la cuadrícula', FileBrowserGridView],
	])('%s no se pone un alto sacado del de la ventana', (_nombre, vista) => {
		const montada = montarVista(vista);

		try {
			// Sobre lo dibujado y no sobre el fuente: lo que importa es que no
			// llegue al elemento, venga de una clase, de un `:class` o de un
			// `style`. Y sobre los atributos y no sobre el HTML entero, que
			// arrastra los comentarios de la plantilla —éste cuenta el número
			// que se sacó, así que lo nombra—.
			const conElAltoDeLaVentana = [...montada.element.querySelectorAll('*')]
				.concat(montada.element)
				.filter((elemento) =>
					/100vh|100dvh/.test(
						`${elemento.getAttribute('class') ?? ''} ${elemento.getAttribute('style') ?? ''}`
					)
				)
				.map((elemento) => elemento.outerHTML.slice(0, 120));

			expect(conElAltoDeLaVentana).toEqual([]);
		} finally {
			montada.unmount();
		}
	});

	test.each([
		['la lista', FileBrowserListView],
		['la cuadrícula', FileBrowserGridView],
	])('%s tampoco se fija un alto propio: lo toma del lugar donde está', (_nombre, vista) => {
		// Un alto fijo de cualquier clase —`h-[420px]`, `h-screen`— vuelve a
		// romper lo mismo: quien sabe cuánto lugar hay es el `ScrollArea` de
		// arriba, y la vista tiene que crecer con sus filas para desbordarlo.
		const montada = montarVista(vista);

		try {
			const raiz = montada.element as HTMLElement;
			const clases = [...raiz.classList];

			// Que haya clases y no una lista vacía: las dos vistas empezaban su
			// plantilla con un comentario **antes** de la raíz, y eso las vuelve
			// un fragmento —comentario más `div`—. Con un fragmento,
			// `wrapper.element` no es el `div`, así que esta prueba pasaba con
			// un `h-[420px]` puesto; y lo que se le pase de afuera como `class`
			// tampoco llega. Los comentarios pasaron adentro de la raíz.
			expect(clases).toContain('flex');
			expect(clases.filter((c) => /^h-/.test(c))).toEqual([]);
			expect(raiz.style.height).toBe('');
		} finally {
			montada.unmount();
		}
	});
});

describe('la cadena de altos de la barra del navegador', () => {
	/**
	 * Los dos envoltorios que la cortaban.
	 *
	 * Se mira lo dibujado y no el fuente: lo que tiene que ser cierto es que el
	 * elemento pueda repartir y encoger alto, venga la clase de donde venga.
	 */
	function envoltorios() {
		const barra = mount(NavigatorBarComponent, {
			global: {
				stubs: {
					FileBrowserComponent: true,
					GlobalSearchView: true,
					ClipboardToolbarComponent: true,
				},
			},
		});

		return {
			barra,
			wrapper: barra.get('.navigator-page__panes-wrapper').classes(),
			container: barra.get('.navigator-page__panes-container').classes(),
		};
	}

	test('reparten el alto en vez de crecer con su contenido', () => {
		const { barra, wrapper, container } = envoltorios();

		try {
			// `flex-1` para tomar el lugar que queda y `min-h-0` para poder
			// encogerse por debajo de su contenido, que es lo que deja que el
			// que desplaza tenga algo que desplazar.
			expect(wrapper).toContain('flex-1');
			expect(wrapper).toContain('min-h-0');
			expect(container).toContain('flex-1');
			expect(container).toContain('min-h-0');
		} finally {
			barra.unmount();
		}
	});

	test('y el de afuera es columna, para que el de adentro tome el alto', () => {
		// `flex-1` sobre un hijo de un bloque no hace nada. Sin esto las dos
		// comprobaciones de arriba pasarían con la cadena igual de rota.
		const { barra, wrapper } = envoltorios();

		try {
			expect(wrapper).toContain('flex');
			expect(wrapper).toContain('flex-col');
		} finally {
			barra.unmount();
		}
	});
});
