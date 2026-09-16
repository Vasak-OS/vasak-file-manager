import { nextTick, type Ref } from 'vue';
import {
	type SeccionVisual,
	vecinoLineal,
	vecinoVertical,
} from '@/composables/file-browser/recorrido-visual';
import type { DirEntry } from '@/types/dir-entry';
import { entryPathSelector } from '@/utils/css-escape';

/**
 * A dónde llevan las flechas.
 *
 * Esto medía rectángulos: pedía todos los elementos con `[data-entry-path]` y
 * comparaba `getBoundingClientRect()` para saber cuál estaba abajo. Funcionaba
 * mientras el directorio entero estuviera dibujado — con la lista virtualizada
 * hay unas veinte filas en el DOM y la veintiuno no existe, así que la flecha
 * se quedaba sin a dónde ir.
 *
 * Ahora el recorrido sale de `recorrido-visual`, que trabaja sobre los datos.
 * Lo único que se sigue preguntando a la pantalla es en cuántas columnas se
 * acomoda cada sección, y eso lo informa la vista: es un número por sección y
 * no una medición por entrada.
 *
 * Enfocar sigue necesitando el elemento, y ahí está la otra mitad: con la vista
 * virtualizada, la fila a la que se va **todavía no existe**. Primero se le pide
 * al desplazador que la ponga a la vista y después se la busca, reintentando un
 * par de veces mientras se dibuja.
 */
export function useFileBrowserKeyboardNavigation(options: {
	entries: Ref<DirEntry[]>;
	selectedEntries: Ref<DirEntry[]>;
	secciones: () => SeccionVisual[];
	desplazarA: (path: string) => boolean;
	selectEntryByPath: (path: string) => boolean;
	goBack: () => void;
	openEntry: (entry: DirEntry) => void;
	entriesContainerRef: Ref<HTMLElement | null>;
}) {
	function getEntryElement(path: string): HTMLElement | null {
		const container = options.entriesContainerRef.value;

		if (!container) return null;

		return container.querySelector<HTMLElement>(`[data-entry-path="${entryPathSelector(path)}"]`);
	}

	function getLastSelectedEntry(): DirEntry | null {
		const selected = options.selectedEntries.value;
		return selected.length > 0 ? selected[selected.length - 1] : null;
	}

	/**
	 * Las secciones tal como se ven, con su cantidad de columnas.
	 *
	 * Si la vista no informó ninguna —la de lista no necesita hacerlo— se toman
	 * las entradas en una sola columna, que es exactamente esa vista.
	 */
	function seccionesVisibles(): SeccionVisual[] {
		const informadas = options.secciones();

		if (informadas.length > 0) return informadas;

		return [{ entradas: options.entries.value, columnas: 1 }];
	}

	/**
	 * Busca el elemento, dándole tiempo a dibujarse.
	 *
	 * Después de pedirle al desplazador que vaya a una fila, esa fila se crea en
	 * el ciclo siguiente — o en el otro, porque el desplazador recalcula al
	 * enterarse del scroll. Un solo `nextTick` alcanza a veces y a veces no, y
	 * cuando no, el foco se pierde sin que falle nada.
	 */
	async function esperarElemento(path: string, intentos = 3): Promise<HTMLElement | null> {
		for (let intento = 0; intento < intentos; intento++) {
			const element = getEntryElement(path);

			if (element) return element;

			await nextTick();
		}

		return getEntryElement(path);
	}

	async function selectAndFocusEntry(entry: DirEntry) {
		options.selectEntryByPath(entry.path);

		// Con la vista virtualizada la fila puede no existir todavía: se le pide
		// al desplazador que la traiga antes de buscarla.
		const loLlevoElDesplazador = options.desplazarA(entry.path);

		await nextTick();

		const element = await esperarElemento(entry.path);

		if (!element) return;

		// Si el desplazador ya la puso a la vista, mover otra vez con
		// `scrollIntoView` la reacomoda de nuevo y se ve un salto.
		if (!loLlevoElDesplazador) {
			element.scrollIntoView({
				block: 'nearest',
				inline: 'nearest',
			});
		}

		element.focus({ preventScroll: true });
	}

	function irA(entry: DirEntry | null) {
		if (entry) selectAndFocusEntry(entry);
	}

	function rutaActual(): string | null {
		return getLastSelectedEntry()?.path ?? null;
	}

	function navigateUp() {
		irA(vecinoVertical(seccionesVisibles(), rutaActual(), 'arriba'));
	}

	function navigateDown() {
		irA(vecinoVertical(seccionesVisibles(), rutaActual(), 'abajo'));
	}

	function navigateLeft() {
		irA(vecinoLineal(seccionesVisibles(), rutaActual(), 'anterior'));
	}

	function navigateRight() {
		irA(vecinoLineal(seccionesVisibles(), rutaActual(), 'siguiente'));
	}

	function openSelected() {
		const selected = options.selectedEntries.value;

		if (selected.length > 0) {
			options.openEntry(selected[0]);
		}
	}

	function navigateBack() {
		options.goBack();
	}

	return {
		navigateUp,
		navigateDown,
		navigateLeft,
		navigateRight,
		openSelected,
		navigateBack,
	};
}
