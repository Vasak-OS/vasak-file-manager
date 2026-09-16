import { type ComponentPublicInstance, nextTick, type Ref, ref, watch } from 'vue';
import type { DirEntry } from '@/types/dir-entry';
import { entryPathSelector } from '@/utils/css-escape';

type PendingFocusRequest =
	| {
			type: 'path';
			targetPath: string;
			path: string;
	  }
	| {
			type: 'diff';
			targetPath: string;
			previousPaths: Set<string>;
	  };

export function useFileBrowserFocus(options: {
	entries: Ref<DirEntry[]>;
	pendingFocusRequest: Ref<PendingFocusRequest | null>;
	currentPath: Ref<string>;
	selectEntryByPath: (path: string) => boolean;
	clearPendingFocusRequest: () => void;
	desplazarA: (path: string) => boolean;
}) {
	const entriesContainerRef = ref<HTMLElement | null>(null);

	function setEntriesContainerRef(element: Element | ComponentPublicInstance | null) {
		entriesContainerRef.value = element instanceof HTMLElement ? element : null;
	}

	function getEntryElement(path: string): HTMLElement | null {
		const container = entriesContainerRef.value;

		if (!container) {
			return null;
		}

		const escapedPath = entryPathSelector(path);

		return container.querySelector<HTMLElement>(`[data-entry-path="${escapedPath}"]`);
	}

	/**
	 * Enfoca una entrada, trayéndola a la vista si hace falta.
	 *
	 * Con las vistas virtualizadas, una entrada fuera de la ventana **no existe
	 * en el DOM**: no alcanza con buscarla y desplazarse a ella. Primero se le
	 * pide al desplazador que la traiga y después se la busca, dándole un par de
	 * ciclos para dibujarse. Sin eso, esto devolvía `false` para cualquier
	 * entrada que no estuviera a la vista —enfocar el archivo recién creado en
	 * una carpeta larga, por ejemplo— y el pedido de foco se perdía.
	 */
	async function focusEntryInView(path: string): Promise<boolean> {
		const loLlevoElDesplazador = options.desplazarA(path);

		await nextTick();

		let entryElement = getEntryElement(path);

		for (let intento = 0; intento < 3 && !entryElement; intento++) {
			await nextTick();
			entryElement = getEntryElement(path);
		}

		if (!entryElement) {
			return false;
		}

		// Si ya la trajo el desplazador, moverla otra vez se ve como un salto.
		if (!loLlevoElDesplazador) {
			entryElement.scrollIntoView({
				block: 'center',
				inline: 'nearest',
			});
		}

		entryElement.focus({
			preventScroll: true,
		});
		return true;
	}

	async function attemptFocusPending() {
		const request = options.pendingFocusRequest.value;

		if (!request) {
			return;
		}

		if (options.currentPath.value !== request.targetPath) {
			return;
		}

		if (request.type === 'path') {
			if (!options.selectEntryByPath(request.path)) {
				return;
			}

			const didFocus = await focusEntryInView(request.path);

			if (didFocus) {
				options.clearPendingFocusRequest();
			}

			return;
		}

		const newEntry = options.entries.value.find((entry) => !request.previousPaths.has(entry.path));

		if (!newEntry) {
			return;
		}

		if (!options.selectEntryByPath(newEntry.path)) {
			return;
		}

		const didFocus = await focusEntryInView(newEntry.path);

		if (didFocus) {
			options.clearPendingFocusRequest();
		}
	}

	watch([options.entries, options.pendingFocusRequest, options.currentPath], () => {
		void attemptFocusPending();
	});

	return {
		entriesContainerRef,
		setEntriesContainerRef,
	};
}
