import {
	type ComponentPublicInstance,
	type ComputedRef,
	type InjectionKey,
	inject,
	provide,
	type Ref,
} from 'vue';
import type { SeccionVisual } from '@/composables/file-browser/recorrido-visual';
import type { DirEntry } from '@/types/dir-entry';
import type { ContextMenuAction, ContextMenuState } from '@/types/file-browser';

export interface FileBrowserContext {
	entries: ComputedRef<DirEntry[]>;
	currentPath: ComputedRef<string>;
	isLoading: Ref<boolean>;
	isDirectoryEmpty: ComputedRef<boolean>;
	error: Ref<string | null>;

	selectedEntries: Ref<DirEntry[]>;
	isEntrySelected: (entry: DirEntry) => boolean;
	contextMenu: Ref<ContextMenuState>;

	getVideoThumbnail: (entry: DirEntry) => string | undefined;
	setEntriesContainerRef: (element: Element | ComponentPublicInstance | null) => void;

	/**
	 * La vista informa cómo se ven las entradas: en cuántas secciones y con
	 * cuántas columnas cada una.
	 *
	 * Es lo único que las flechas necesitan saber de la pantalla. Antes lo
	 * averiguaban midiendo cada elemento dibujado, que es justamente lo que deja
	 * de existir al virtualizar. La de lista no la llama: una sola sección de
	 * una columna es lo que se asume.
	 */
	registrarSeccionesVisuales: (secciones: SeccionVisual[]) => void;

	onEntryMouseDown: (entry: DirEntry, event: MouseEvent) => void;
	onEntryMouseUp: (entry: DirEntry, event: MouseEvent) => void;
	openEntryContextMenu: (entry: DirEntry, event: MouseEvent) => void;
	onContextMenuAction: (action: ContextMenuAction) => void;
	openOpenWithDialog: (entries: DirEntry[]) => void;
	navigateToHome: () => void | Promise<void>;

	entryDescription?: (entry: DirEntry) => string | undefined;
}

const FILE_BROWSER_CONTEXT_KEY: InjectionKey<FileBrowserContext> = Symbol('FileBrowserContext');

export { FILE_BROWSER_CONTEXT_KEY };

export function provideFileBrowserContext(context: FileBrowserContext): void {
	provide(FILE_BROWSER_CONTEXT_KEY, context);
}

export function useFileBrowserContext(): FileBrowserContext {
	const context = inject(FILE_BROWSER_CONTEXT_KEY);

	if (!context) {
		throw new Error(
			'useFileBrowserContext must be used within a FileBrowser component that provides the context'
		);
	}

	return context;
}
