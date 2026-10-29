import type { ComputedRef, Ref } from 'vue';
import { computed, nextTick, ref, toRef } from 'vue';
import {
	clampIconScale,
	DEFAULT_ICON_SCALE,
	stepIconScale,
} from '@/composables/file-browser/icon-scale';
import type { SeccionVisual } from '@/composables/file-browser/recorrido-visual';
import { useFileBrowserActions } from '@/composables/file-browser/use-file-browser-actions';
import { useFileBrowserDialogs } from '@/composables/file-browser/use-file-browser-dialogs';
import { useFileBrowserDrag } from '@/composables/file-browser/use-file-browser-drag';
import { useFileBrowserEntries } from '@/composables/file-browser/use-file-browser-entries';
import { useFileBrowserExternalDrop } from '@/composables/file-browser/use-file-browser-external-drop';
import { useFileBrowserFilter } from '@/composables/file-browser/use-file-browser-filter';
import { useFileBrowserFocus } from '@/composables/file-browser/use-file-browser-focus';
import { useFileBrowserKeyboardNavigation } from '@/composables/file-browser/use-file-browser-keyboard-navigation';
import { useFileBrowserLifecycle } from '@/composables/file-browser/use-file-browser-lifecycle';
import { useFileBrowserNavigation } from '@/composables/file-browser/use-file-browser-navigation';
import { useFileBrowserSelection } from '@/composables/file-browser/use-file-browser-selection';
import { useVideoThumbnails } from '@/composables/file-browser/use-video-thumbnails';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useDirSizesStore } from '@/stores/runtime/dir-sizes';
import { useDismissalLayerStore } from '@/stores/runtime/dismissal-layer';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useQuickViewStore } from '@/stores/runtime/quick-view';
import type { DirContents, DirEntry } from '@/types/dir-entry';
import type { ListSortColumn, ListSortDirection } from '@/types/file-browser';
import type { Layout } from '@/types/navigator';
import type { Tab } from '@/types/workspaces';
import { entryPathSelector } from '@/utils/css-escape';
import { sortFileBrowserEntries } from '@/utils/file-browser-sort';

export interface UseFileBrowserOptions {
	tab: () => Tab | undefined;
	layout: () => Layout | undefined;
	externalEntries?: () => DirEntry[];
	basePath?: () => string;
	onSelectedEntriesChange: (entries: DirEntry[]) => void;
	onCurrentDirEntryChange: (entry: DirEntry | null) => void;
	onOpenEntry: (entry: DirEntry) => void;
	componentRef: Ref<HTMLElement | null>;
}

interface DataSource {
	entries: ComputedRef<DirEntry[]>;
	currentPath: ComputedRef<string>;
	isDirectoryEmpty: ComputedRef<boolean>;
	dirContents: Ref<DirContents | null>;
	isLoading: Ref<boolean>;
	isRefreshing: Ref<boolean>;
	error: Ref<string | null>;
	pathInput: Ref<string>;
	canGoBack: Ref<boolean>;
	canGoForward: Ref<boolean>;
	parentPath: ComputedRef<string | null> | Ref<string | null>;
	navigateToPath: (path: string) => Promise<void>;
	navigateToEntry: (entry: DirEntry) => Promise<void>;
	navigateToParent: () => Promise<void>;
	navigateToHome: () => Promise<void>;
	goBack: () => void;
	goForward: () => void;
	refresh: () => void;
	handlePathSubmit: () => Promise<void>;
	openFile: (path: string) => Promise<void>;
	silentRefresh: () => void;
	filterQuery: Ref<string>;
	isFilterOpen: Ref<boolean>;
	toggleFilter: () => void;
	openFilter: () => void;
	closeFilter: () => void;
	showHiddenFiles: Ref<boolean>;
	toggleHiddenFiles: () => void;
	/**
	 * La escala discreta de íconos y tarjetas de la pestaña. En la navegación
	 * está atada al `iconScale` de la pestaña —se persiste con ella—; en la
	 * búsqueda global es efímera.
	 */
	iconScale: Ref<number>;
	/**
	 * El orden de las entradas: la columna y la dirección.
	 *
	 * Es la única fuente del estado de orden. La cabecera de la lista escribe
	 * acá y el arreglo que sale de `entries` ya viene ordenado con el mismo
	 * criterio para la vista y para el recorrido por teclado.
	 */
	listSortColumn: Ref<ListSortColumn | null>;
	listSortDirection: Ref<ListSortDirection>;
}

function setupNavigationDataSource(
	options: UseFileBrowserOptions,
	onNavigationCleanup: () => void
): DataSource {
	const dismissalLayerStore = useDismissalLayerStore();
	const globalSearchStore = useGlobalSearchStore();

	const navigation = useFileBrowserNavigation(
		options.tab,
		(dirEntry) => options.onCurrentDirEntryChange(dirEntry),
		onNavigationCleanup
	);

	const filter = useFileBrowserFilter({
		dismissalLayerStore,
		globalSearchStore,
	});

	// Los ocultos arrancan escondidos, que es lo que espera cualquiera que no
	// los fue a buscar, y se muestran con Ctrl+H. Es por panel: en vista
	// dividida tiene sentido mirar los de un lado sin llenar el otro.
	const showHiddenFiles = ref(false);
	const toggleHiddenFiles = () => {
		showHiddenFiles.value = !showHiddenFiles.value;
	};
	// El orden es uno solo para la lista y para la cuadrícula, y arranca por
	// nombre ascendente, que es lo que marcan las flechas de la cabecera. La
	// misma copia ordenada la leen la vista, el foco y el teclado.
	const listSortColumn = ref<ListSortColumn | null>('name');
	const listSortDirection = ref<ListSortDirection>('asc');
	const { entries: filteredEntries, isDirectoryEmpty: filteredIsDirectoryEmpty } =
		useFileBrowserEntries(
			navigation.dirContents,
			filter.filterQuery,
			showHiddenFiles,
			listSortColumn,
			listSortDirection
		);

	const tabRef = toRef(options.tab);

	// El zoom vive en la pestaña: escribirlo muta el objeto `Tab`, que el store
	// de workspaces persiste solo por su watcher profundo.
	const iconScale = computed<number>({
		get: () => clampIconScale(tabRef.value?.iconScale ?? DEFAULT_ICON_SCALE),
		set: (value) => {
			if (tabRef.value) {
				tabRef.value.iconScale = clampIconScale(value);
			}
		},
	});

	useFileBrowserLifecycle({
		tabRef,
		readDir: navigation.readDir,
		init: navigation.init,
	});

	return {
		entries: computed(() => filteredEntries.value),
		currentPath: computed(() => navigation.currentPath.value),
		isDirectoryEmpty: computed(() => filteredIsDirectoryEmpty.value),
		dirContents: navigation.dirContents,
		isLoading: navigation.isLoading,
		isRefreshing: navigation.isRefreshing,
		error: navigation.error,
		pathInput: navigation.pathInput,
		canGoBack: navigation.canGoBack,
		canGoForward: navigation.canGoForward,
		parentPath: navigation.parentPath,
		navigateToPath: navigation.navigateToPath,
		navigateToEntry: navigation.navigateToEntry,
		navigateToParent: navigation.navigateToParent,
		navigateToHome: navigation.navigateToHome,
		goBack: navigation.goBack,
		goForward: navigation.goForward,
		refresh: navigation.refresh,
		handlePathSubmit: navigation.handlePathSubmit,
		openFile: navigation.openFile,
		silentRefresh: navigation.silentRefresh,
		filterQuery: filter.filterQuery,
		isFilterOpen: filter.isFilterOpen,
		toggleFilter: filter.toggleFilter,
		showHiddenFiles,
		toggleHiddenFiles,
		iconScale,
		openFilter: filter.openFilter,
		closeFilter: filter.closeFilter,
		listSortColumn,
		listSortDirection,
	};
}

function setupExternalDataSource(options: UseFileBrowserOptions): DataSource {
	const globalSearchStore = useGlobalSearchStore();
	const dirSizesStore = useDirSizesStore();
	const getEntries = options.externalEntries ?? (() => []);
	const getBasePath = options.basePath ?? (() => '');

	// Mismo orden y mismo arranque que la navegación: la barra de la búsqueda
	// global también tiene sus cabeceras y su flecha.
	const listSortColumn = ref<ListSortColumn | null>('name');
	const listSortDirection = ref<ListSortDirection>('asc');

	const entries = computed(() => {
		const rawEntries = getEntries();

		if (options.layout() !== 'list') {
			return rawEntries;
		}

		const column = listSortColumn.value ?? 'name';
		return sortFileBrowserEntries(rawEntries, column, listSortDirection.value, dirSizesStore);
	});

	return {
		entries,
		currentPath: computed(() => getBasePath()),
		isDirectoryEmpty: computed(() => getEntries().length === 0),
		dirContents: ref(null),
		isLoading: ref(false),
		isRefreshing: ref(false),
		error: ref(null),
		pathInput: ref(''),
		canGoBack: ref(false),
		canGoForward: ref(false),
		parentPath: ref(null),
		navigateToPath: async () => {},
		navigateToEntry: async () => {},
		navigateToParent: async () => {},
		navigateToHome: async () => {},
		goBack: () => {},
		goForward: () => {},
		refresh: () => {},
		handlePathSubmit: async () => {},
		openFile: async () => {},
		silentRefresh: () => {
			globalSearchStore.search();
		},
		filterQuery: ref(''),
		isFilterOpen: ref(false),
		toggleFilter: () => {},
		openFilter: () => {},
		closeFilter: () => {},
		// Los resultados de la búsqueda global vienen de otro lado y ya
		// incluyen lo que corresponda: acá no hay directorio que filtrar.
		showHiddenFiles: ref(true),
		toggleHiddenFiles: () => {},
		iconScale: ref(DEFAULT_ICON_SCALE),
		listSortColumn,
		listSortDirection,
	};
}

export function useFileBrowser(options: UseFileBrowserOptions) {
	const isExternalMode = !!options.externalEntries;
	const quickViewStore = useQuickViewStore();
	const clipboardStore = useClipboardStore();

	const dataSource = isExternalMode
		? setupExternalDataSource(options)
		: setupNavigationDataSource(options, () => {
				selection.clearSelection();
				selection.resetMouseState();
			});

	const selection = useFileBrowserSelection(
		dataSource.entries,
		dataSource.currentPath,
		(selectedItems) => options.onSelectedEntriesChange(selectedItems),
		async (entry) => {
			if (isExternalMode) {
				options.onOpenEntry(entry);
				return;
			}

			if (entry.is_dir) {
				await dataSource.navigateToEntry(entry);
			} else {
				await dataSource.openFile(entry.path);
			}
		},
		dataSource.silentRefresh
	);

	/**
	 * Cómo llevar la pantalla hasta una entrada, según la vista que esté puesta.
	 *
	 * Lo informa la vista porque es la que tiene el desplazador. Si no hay
	 * ninguna informada —o la entrada no está en su lista— se contesta que no, y
	 * quien llamó se las arregla con el DOM, que es lo que se hacía antes.
	 */
	const desplazarAEntrada = ref<((path: string) => boolean) | null>(null);

	function registrarDesplazamiento(desplazar: ((path: string) => boolean) | null) {
		desplazarAEntrada.value = desplazar;
	}

	function desplazarA(path: string): boolean {
		return desplazarAEntrada.value?.(path) ?? false;
	}

	const { entriesContainerRef, setEntriesContainerRef } = useFileBrowserFocus({
		entries: dataSource.entries,
		pendingFocusRequest: selection.pendingFocusRequest,
		currentPath: dataSource.currentPath,
		selectEntryByPath: selection.selectEntryByPath,
		clearPendingFocusRequest: selection.clearPendingFocusRequest,
		desplazarA,
	});

	const videoThumbnails = !isExternalMode
		? useVideoThumbnails()
		: { getVideoThumbnail: () => undefined };

	const dialogs = useFileBrowserDialogs({
		renameState: selection.renameState,
		cancelRename: selection.cancelRename,
		confirmRename: selection.confirmRename,
		batchRenameState: selection.batchRenameState,
		cancelBatchRename: selection.cancelBatchRename,
		confirmBatchRename: selection.confirmBatchRename,
		createNewItem: selection.createNewItem,
	});

	const drag = useFileBrowserDrag({
		selectedEntries: selection.selectedEntries,
		currentPath: dataSource.currentPath,
		componentRef: options.componentRef,
		isEntrySelected: selection.isEntrySelected,
		replaceSelection: selection.replaceSelection,
		entriesContainerRef,
		disableBackgroundDrop: isExternalMode,
		onDrop: async (items, destinationPath, operation) => {
			if (operation === 'link') {
				await selection.linkItems(items, destinationPath);
				return;
			}

			clipboardStore.isToolbarSuppressed = true;

			if (operation === 'copy') {
				selection.copyItems(items);
			} else {
				selection.cutItems(items);
			}

			const success = await selection.pasteItems(destinationPath);

			if (!success && clipboardStore.hasItems) {
				clipboardStore.clearClipboard();
			}
		},
		// A la papelera y no borrado definitivo: la acción la eligió la aplicación
		// de destino, no quien arrastró, así que tiene que poder volverse atrás con
		// deshacer. Recuperable es mejor que preguntar: no cuesta ningún clic en el
		// caso normal y protege igual el caso equivocado.
		onExternalMove: (items) => {
			// A la papelera, y **sin elevar**: la acción la eligió la aplicación de
			// destino, no quien arrastró. Si no entra en la papelera, el original se
			// queda donde está — pedir la contraseña para borrar definitivo algo que
			// nadie pidió borrar sería lo peor de los dos mundos.
			void selection.deleteItems(items, true, false);
		},
	});

	const externalDrop = useFileBrowserExternalDrop({
		componentRef: options.componentRef,
		currentPath: dataSource.currentPath,
		entriesContainerRef,
		disableBackgroundDrop: isExternalMode,
		onDrop: (sourcePaths, targetPath, operation) => {
			selection.handleExternalDrop(sourcePaths, targetPath, operation);
		},
	});

	const actions = useFileBrowserActions({
		contextMenu: selection.contextMenu,
		selectedEntries: selection.selectedEntries,
		quickViewStore,
		handleContextMenuAction: selection.handleContextMenuAction,
		openOpenWithDialog: dialogs.openOpenWithDialog,
		handleEntryMouseDown: selection.handleEntryMouseDown,
		handleEntryMouseUp: selection.handleEntryMouseUp,
		handleDragMouseDown: drag.handleDragMouseDown,
		isDragging: drag.isDragging,
	});

	const keyboardNavDefaults = {
		navigateUp: () => {},
		navigateDown: () => {},
		navigateLeft: () => {},
		navigateRight: () => {},
		openSelected: () => {},
		navigateBack: () => {},
	};

	/**
	 * Cómo se ven las entradas: en cuántas secciones y con cuántas columnas cada
	 * una. Lo informa la vista, que es la única que lo sabe — la de lista es una
	 * sección de una columna y no necesita decir nada; la de cuadrícula son
	 * cuatro, con anchos distintos.
	 *
	 * Existe para que las flechas no tengan que medir la pantalla. Ver
	 * `recorrido-visual`.
	 */
	const seccionesVisuales = ref<SeccionVisual[]>([]);

	function registrarSeccionesVisuales(secciones: SeccionVisual[]) {
		seccionesVisuales.value = secciones;
	}

	const keyboardNav = !isExternalMode
		? useFileBrowserKeyboardNavigation({
				entries: dataSource.entries,
				selectedEntries: selection.selectedEntries,
				secciones: () => seccionesVisuales.value,
				desplazarA,
				selectEntryByPath: selection.selectEntryByPath,
				goBack: dataSource.goBack,
				openEntry: async (entry) => {
					if (entry.is_dir) {
						await dataSource.navigateToEntry(entry);
					} else {
						await dataSource.openFile(entry.path);
					}
				},
				entriesContainerRef,
			})
		: keyboardNavDefaults;

	function zoomIn() {
		dataSource.iconScale.value = stepIconScale(dataSource.iconScale.value, 1);
	}

	function zoomOut() {
		dataSource.iconScale.value = stepIconScale(dataSource.iconScale.value, -1);
	}

	function zoomReset() {
		dataSource.iconScale.value = DEFAULT_ICON_SCALE;
	}

	async function selectFirstEntry() {
		if (dataSource.entries.value.length === 0) return;

		const firstEntry = dataSource.entries.value[0];
		selection.selectEntryByPath(firstEntry.path);
		await nextTick();

		if (entriesContainerRef.value) {
			const element = entriesContainerRef.value.querySelector<HTMLElement>(
				`[data-entry-path="${entryPathSelector(firstEntry.path)}"]`
			);

			if (element) {
				element.scrollIntoView({
					block: 'nearest',
					inline: 'nearest',
				});
				element.focus({ preventScroll: true });
			}
		}
	}

	return {
		isExternalMode,

		entries: dataSource.entries,
		// El estado del orden, para que la cabecera de la lista lo escriba: es
		// la única fuente, y `entries` ya sale ordenado con ese criterio.
		listSortColumn: dataSource.listSortColumn,
		listSortDirection: dataSource.listSortDirection,
		currentPath: dataSource.currentPath,
		isDirectoryEmpty: dataSource.isDirectoryEmpty,
		dirContents: dataSource.dirContents,
		isLoading: dataSource.isLoading,
		isRefreshing: dataSource.isRefreshing,
		error: dataSource.error,

		pathInput: dataSource.pathInput,
		canGoBack: dataSource.canGoBack,
		canGoForward: dataSource.canGoForward,
		parentPath: dataSource.parentPath,
		navigateToPath: dataSource.navigateToPath,
		navigateToParent: dataSource.navigateToParent,
		navigateToHome: dataSource.navigateToHome,
		goBack: dataSource.goBack,
		goForward: dataSource.goForward,
		refresh: dataSource.refresh,
		handlePathSubmit: dataSource.handlePathSubmit,
		openFile: dataSource.openFile,

		filterQuery: dataSource.filterQuery,
		isFilterOpen: dataSource.isFilterOpen,
		toggleFilter: dataSource.toggleFilter,
		showHiddenFiles: dataSource.showHiddenFiles,
		toggleHiddenFiles: dataSource.toggleHiddenFiles,
		iconScale: dataSource.iconScale,
		zoomIn,
		zoomOut,
		zoomReset,
		openFilter: dataSource.openFilter,
		closeFilter: dataSource.closeFilter,

		selectedEntries: selection.selectedEntries,
		contextMenu: selection.contextMenu,
		renameState: selection.renameState,
		batchRenameState: selection.batchRenameState,
		isEntrySelected: selection.isEntrySelected,
		clearSelection: selection.clearSelection,
		selectAll: selection.selectAll,
		invertSelection: selection.invertSelection,
		selectByPattern: selection.selectByPattern,
		copySelectedPaths: selection.copySelectedPaths,
		selectEntryByPath: selection.selectEntryByPath,
		removeFromSelection: selection.removeFromSelection,
		handleEntryContextMenu: selection.handleEntryContextMenu,
		copyItems: selection.copyItems,
		cutItems: selection.cutItems,
		pasteItems: selection.pasteItems,
		linkItems: selection.linkItems,
		deleteItems: selection.deleteItems,
		startRename: selection.startRename,
		startBatchRename: selection.startBatchRename,
		conflictDialogState: selection.conflictDialogState,
		handleConflictResolution: selection.handleConflictResolution,
		handleConflictCancel: selection.handleConflictCancel,
		compressDialogState: selection.compressDialogState,
		openCompressDialog: selection.openCompressDialog,
		handleCompressConfirm: selection.handleCompressConfirm,
		handleCompressCancel: selection.handleCompressCancel,
		undoLastOperation: selection.undoLastOperation,
		redoLastOperation: selection.redoLastOperation,

		getVideoThumbnail: videoThumbnails.getVideoThumbnail,
		entriesContainerRef,
		setEntriesContainerRef,
		registrarSeccionesVisuales,
		registrarDesplazamiento,

		openWithState: dialogs.openWithState,
		newItemDialogState: dialogs.newItemDialogState,
		isRenameDialogOpen: dialogs.isRenameDialogOpen,
		isBatchRenameDialogOpen: dialogs.isBatchRenameDialogOpen,
		isNewItemDialogOpen: dialogs.isNewItemDialogOpen,
		openOpenWithDialog: dialogs.openOpenWithDialog,
		closeOpenWithDialog: dialogs.closeOpenWithDialog,
		openNewItemDialog: dialogs.openNewItemDialog,
		handleRenameConfirm: dialogs.handleRenameConfirm,
		handleRenameCancel: dialogs.handleRenameCancel,
		handleBatchRenameConfirm: dialogs.handleBatchRenameConfirm,
		handleBatchRenameCancel: dialogs.handleBatchRenameCancel,
		handleNewItemConfirm: dialogs.handleNewItemConfirm,
		handleNewItemCancel: dialogs.handleNewItemCancel,

		isDragging: drag.isDragging,
		dragItems: drag.dragItems,
		dragOperationType: drag.operationType,
		dragCursorX: drag.cursorX,
		dragCursorY: drag.cursorY,
		isCrossPaneTarget: drag.isCrossPaneTarget,

		isExternalDragActive: externalDrop.isExternalDragActive,
		externalDragItemCount: externalDrop.externalDragItemCount,
		externalDragOperationType: externalDrop.externalDragOperationType,
		isCurrentDirLocked: externalDrop.isCurrentDirLocked,
		isTargetingEntry: externalDrop.isTargetingEntry,

		onContextMenuAction: actions.onContextMenuAction,
		onEntryMouseDown: actions.onEntryMouseDown,
		onEntryMouseUp: actions.onEntryMouseUp,

		quickView: actions.quickView,
		selectFirstEntry,

		navigateUp: keyboardNav.navigateUp,
		navigateDown: keyboardNav.navigateDown,
		navigateLeft: keyboardNav.navigateLeft,
		navigateRight: keyboardNav.navigateRight,
		openSelected: keyboardNav.openSelected,
		navigateBack: keyboardNav.navigateBack,
	};
}
