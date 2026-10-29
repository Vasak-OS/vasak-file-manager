import { invoke } from '@tauri-apps/api/core';
import { dirname } from '@tauri-apps/api/path';
import type { MenuEntry } from '@vasakgroup/plugin-vsk-contextual-menu';
import { useContextMenu } from '@vasakgroup/plugin-vsk-contextual-menu';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, onBeforeUnmount, onMounted, type Ref, ref } from 'vue';
import { useContextMenuItems } from '@/composables/file-browser/use-context-menu-items';
import { useClipboardStore } from '@/stores/runtime/clipboard';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useTerminalsStore } from '@/stores/runtime/terminals';
import { useUserStatsStore } from '@/stores/storage/user-stats';
import type { DirEntry } from '@/types/dir-entry';
import type { ContextMenuAction, ContextMenuState } from '@/types/file-browser';
import type { ShortcutId } from '@/types/shortcut';

/**
 * El menú del clic derecho sobre los archivos.
 *
 * Lo dibuja el menú del escritorio —el mismo de todo VasakOS—, así que acá sólo
 * se describe qué ofrece el gestor sobre lo que está seleccionado. El plugin se
 * ocupa del aspecto, del teclado, de los submenús y de cerrarse.
 */

const ADMIN_MODIFIER_KEY = 'Shift';

interface AssociatedProgram {
	name: string;
	path: string;
	icon: string | null;
	is_default: boolean;
}

interface GetAssociatedProgramsResult {
	success: boolean;
	recommended_programs: AssociatedProgram[];
	other_programs: AssociatedProgram[];
	default_program: AssociatedProgram | null;
	error: string | null;
}

interface OpenWithResult {
	success: boolean;
	error: string | null;
}

export function actionItem(
	action: ContextMenuAction,
	label: string,
	icon: string,
	options?: { accelerator?: string; danger?: boolean }
): MenuEntry {
	return {
		id: `action:${action}`,
		label,
		icon,
		accelerator: options?.accelerator,
		danger: options?.danger,
	};
}

/** Los separadores sólo valen entre dos renglones: sueltos son una raya sola. */
export function tidySeparators(items: MenuEntry[]): MenuEntry[] {
	const limpios: MenuEntry[] = [];

	for (const item of items) {
		const esSeparador = 'type' in item && item.type === 'separator';
		const anterior = limpios[limpios.length - 1];
		const anteriorEsSeparador = anterior && 'type' in anterior && anterior.type === 'separator';

		if (esSeparador && (limpios.length === 0 || anteriorEsSeparador)) continue;

		limpios.push(item);
	}

	const ultimo = limpios[limpios.length - 1];
	if (ultimo && 'type' in ultimo && ultimo.type === 'separator') limpios.pop();

	return limpios;
}

/**
 * La carpeta donde abrir la terminal: la seleccionada, o la que contiene al
 * archivo.
 *
 * El padre lo resuelve `dirname`, el mismo que usa la barra de direcciones.
 * Contando separadores a mano la raíz salía mal —para `/archivo` devolvía
 * `/archivo`—, y la terminal se abría en un archivo en vez de en `/`.
 */
export async function terminalTargetPath(entries: DirEntry[]): Promise<string | null> {
	const primera = entries[0];
	if (!primera) return null;
	if (primera.is_dir) return primera.path;

	try {
		return await dirname(primera.path);
	} catch (error) {
		console.warn('No se pudo resolver la carpeta que contiene al archivo:', error);
		return null;
	}
}

/** Abre cada entrada con el programa dado; corta en el primer error. */
export async function openWithProgram(programPath: string, entries: DirEntry[]) {
	try {
		for (const entry of entries) {
			const resultado = await invoke<OpenWithResult>('open_with_program', {
				filePath: entry.path,
				programPath,
				arguments: [],
			});

			if (!resultado.success) {
				console.error('Failed to open file:', resultado.error);
				return;
			}
		}
	} catch (invokeError) {
		console.error('Failed to open file:', invokeError);
	}
}

/** Un programa asociado como ítem del submenú «Abrir con». */
export function programaItem(programa: AssociatedProgram): MenuEntry {
	return {
		id: `open-with:${programa.path}`,
		label: programa.name,
		icon: programa.icon ?? 'text-x-generic',
	};
}

/**
 * Las secciones de «Abrir con»: el programa por defecto, los sugeridos y los
 * otros que igual pueden abrirlo. Cada sección va con su separador si hay algo
 * arriba; si no hay ninguno, un renglón que lo dice.
 */
export function seccionesDeProgramas(
	resultado: GetAssociatedProgramsResult | null,
	t: (key: string) => string
): MenuEntry[] {
	const items: MenuEntry[] = [];
	const porDefecto = resultado?.default_program ?? null;

	if (porDefecto) {
		items.push({ type: 'label', label: t('openWith.defaultApp') });
		items.push(programaItem(porDefecto));
	}

	const agregarSeccion = (labelKey: string, programas: AssociatedProgram[]) => {
		if (programas.length === 0) return;
		if (items.length > 0) items.push({ type: 'separator' });
		items.push({ type: 'label', label: t(labelKey) });
		for (const programa of programas) items.push(programaItem(programa));
	};

	agregarSeccion('openWith.suggestedApps', resultado?.recommended_programs ?? []);
	agregarSeccion('openWith.otherApps', resultado?.other_programs ?? []);

	if (items.length === 0) {
		items.push({ type: 'label', label: t('openWith.noProgramsFound') });
	}

	return items;
}

export interface UseEntryContextMenuOptions {
	contextMenu: Ref<ContextMenuState>;
	/** Deja seleccionado lo que se va a operar antes de armar el menú. */
	handleEntryContextMenu: (entry: DirEntry) => void;
	onAction: (action: ContextMenuAction) => void;
	openOpenWithDialog: (entries: DirEntry[]) => void;
}

export function useEntryContextMenu(options: UseEntryContextMenuOptions) {
	const { t } = useI18n();
	const { show } = useContextMenu();

	const clipboardStore = useClipboardStore();
	const shortcutsStore = useShortcutsStore();
	const terminalsStore = useTerminalsStore();
	const userStatsStore = useUserStatsStore();

	const selectedEntries = computed(() => options.contextMenu.value.selectedEntries);
	const { isActionVisible } = useContextMenuItems(selectedEntries);

	/**
	 * Shift abre la terminal como administrador.
	 *
	 * El menú se arma una vez y no cambia mientras está abierto, así que la tecla
	 * se mira recién cuando se eligió: mantenerla apretada hasta soltar el clic
	 * es lo que hacía antes y lo que dice el renglón del submenú.
	 */
	const isShiftHeld = ref(false);

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === ADMIN_MODIFIER_KEY) isShiftHeld.value = true;
	}

	function onKeyUp(event: KeyboardEvent) {
		if (event.key === ADMIN_MODIFIER_KEY) isShiftHeld.value = false;
	}

	function forgetModifier() {
		isShiftHeld.value = false;
	}

	onMounted(() => {
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('blur', forgetModifier);

		// Las terminales instaladas se piden de entrada: el menú se arma entero
		// antes de dibujarse, y esperarlas ahí sería esperar con el botón apretado.
		void terminalsStore.init();
	});

	onBeforeUnmount(() => {
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);
		window.removeEventListener('blur', forgetModifier);
	});

	const selectedDirectory = computed(() => selectedEntries.value.find((entry) => entry.is_dir));

	const canPasteToSelectedDirectory = computed(() => {
		if (!clipboardStore.hasItems || !selectedDirectory.value) return false;

		return clipboardStore.canPasteTo(selectedDirectory.value.path);
	});

	const allSelectedAreFavorites = computed(() =>
		selectedEntries.value.every((entry) => userStatsStore.isFavorite(entry.path))
	);

	const selectedTagIds = computed(() => {
		const entries = selectedEntries.value;
		if (entries.length === 0) return [] as string[];

		const porEntrada = entries.map((entry) => {
			const etiquetado = userStatsStore.taggedItems.find((item) => item.path === entry.path);

			return new Set(etiquetado?.tagIds ?? []);
		});

		const primera = porEntrada[0] ?? new Set<string>();

		return Array.from(primera).filter((tagId) => porEntrada.every((tags) => tags.has(tagId)));
	});

	/**
	 * Lo que contestó el sistema para cada ruta.
	 *
	 * El menú se arma entero antes de dibujarse, así que preguntar de nuevo es
	 * demora entre el clic y el menú. Volver a abrirlo sobre el mismo archivo
	 * —que es lo que más pasa— ya no espera nada.
	 */
	const programasPorRuta = new Map<string, GetAssociatedProgramsResult>();

	async function openWithItems(entries: DirEntry[]): Promise<MenuEntry[]> {
		const primera = entries[0];

		let resultado: GetAssociatedProgramsResult | null = programasPorRuta.get(primera.path) ?? null;
		let error: string | null = null;

		if (!resultado) {
			try {
				resultado = await invoke<GetAssociatedProgramsResult>('get_associated_programs', {
					filePath: primera.path,
				});

				if (resultado.success) programasPorRuta.set(primera.path, resultado);
			} catch (invokeError) {
				error = String(invokeError);
			}
		}

		if (resultado && !resultado.success) {
			error = resultado.error || t('openWith.failedToLoadPrograms');
		}

		if (error) {
			return [{ type: 'label', label: error }];
		}

		// El sistema también devuelve los que pueden abrir el archivo aunque no
		// los recomiende. El menú los venía ignorando —también el de antes—, así
		// que «abrir con» escondía programas que sí sirven y ya estaban pedidos.
		const items = seccionesDeProgramas(resultado, t);

		if (!primera.is_dir) {
			items.push({ type: 'separator' });
			items.push({
				id: 'open-with:custom',
				label: t('openWith.customCommandWithFlags'),
				icon: 'settings-configure',
			});
		}

		return items;
	}

	async function terminalItems(): Promise<MenuEntry[]> {
		if (!terminalsStore.hasLoaded) {
			await terminalsStore.init();
		}

		if (terminalsStore.loadError) {
			return [{ type: 'label', label: terminalsStore.loadError }];
		}

		if (terminalsStore.terminals.length === 0) {
			return [{ type: 'label', label: t('terminal.noTerminalsFound') }];
		}

		const items: MenuEntry[] = [
			{
				type: 'label',
				label: `${t('terminal.holdModifierForAdmin').replace('{modifier}', ADMIN_MODIFIER_KEY)} — ${shortcutsStore.getShortcutLabel('openTerminalAdmin')}`,
			},
			{ type: 'separator' },
		];

		for (const terminal of terminalsStore.terminals) {
			items.push({
				id: `terminal:${terminal.id}`,
				label: terminal.isDefault
					? `${terminal.name} (${t('terminal.defaultLabel')})`
					: terminal.name,
				icon: terminal.icon ?? 'utilities-terminal',
			});
		}

		return items;
	}

	function tagItems(): MenuEntry[] {
		const etiquetas = userStatsStore.tags;

		if (etiquetas.length === 0) {
			return [{ type: 'label', label: t('fileBrowser.actions.noTags') }];
		}

		return etiquetas.map((etiqueta) => ({
			type: 'checkbox' as const,
			id: `tag:${etiqueta.id}`,
			label: etiqueta.name,
			checked: selectedTagIds.value.includes(etiqueta.id),
		}));
	}

	/** Agrega un ítem de acción simple si la acción es visible. */
	function agregarAccion(
		items: MenuEntry[],
		action: ContextMenuAction,
		labelKey: string,
		icon: string,
		extra?: { atajo?: ShortcutId; danger?: boolean }
	) {
		if (!isActionVisible(action)) return;

		items.push(
			actionItem(action, t(labelKey), icon, {
				accelerator: extra?.atajo ? shortcutsStore.getShortcutLabel(extra.atajo) : undefined,
				danger: extra?.danger,
			})
		);
	}

	async function buildMenu(entries: DirEntry[]): Promise<MenuEntry[]> {
		const items: MenuEntry[] = [];

		agregarAccion(items, 'rename', 'fileBrowser.actions.rename', 'edit-rename', {
			atajo: 'rename',
		});
		agregarAccion(items, 'batch-rename', 'fileBrowser.actions.batchRename', 'edit-rename', {
			atajo: 'rename',
		});
		agregarAccion(items, 'copy', 'fileBrowser.actions.copy', 'edit-copy', { atajo: 'copy' });
		agregarAccion(items, 'cut', 'fileBrowser.actions.cut', 'edit-cut', { atajo: 'cut' });
		agregarAccion(items, 'copy-path', 'fileBrowser.actions.copyPath', 'edit-copy', {
			atajo: 'copyPath',
		});

		if (canPasteToSelectedDirectory.value) {
			items.push(
				actionItem('paste', t('fileBrowser.actions.paste'), 'edit-paste', {
					accelerator: shortcutsStore.getShortcutLabel('paste'),
				})
			);
		}

		if (isActionVisible('delete')) {
			items.push(
				actionItem('delete', t('fileBrowser.actions.delete'), 'user-trash', {
					accelerator: shortcutsStore.getShortcutLabel('delete'),
				})
			);
			// Antes era el mismo renglón con Shift apretado, que no se veía. El menú
			// no cambia mientras está abierto, así que borrar del disco pasa a ser
			// una opción propia, en rojo y con su atajo a la vista.
			items.push(
				actionItem(
					'delete-permanently',
					t('fileBrowser.actions.deletePermanently'),
					'edit-delete-shred',
					{
						accelerator: shortcutsStore.getShortcutLabel('deletePermanently'),
						danger: true,
					}
				)
			);
		}

		items.push({ type: 'separator' });

		if (isActionVisible('open-with')) {
			items.push({
				type: 'submenu',
				label: t('fileBrowser.actions.openWith'),
				icon: 'external-link-symbolic',
				items: await openWithItems(entries),
			});
		}

		items.push({
			type: 'submenu',
			label: `${t('terminal.openInTerminal')} — ${shortcutsStore.getShortcutLabel('openTerminal')}`,
			icon: 'utilities-terminal',
			items: await terminalItems(),
		});

		agregarAccion(items, 'open-in-new-tab', 'fileBrowser.actions.openInNewTab', 'gtk-add', {
			atajo: 'openNewTab',
		});
		agregarAccion(items, 'share', 'fileBrowser.actions.share', 'emblem-shared');
		agregarAccion(
			items,
			'extract-here',
			'fileBrowser.actions.extractHere',
			'application-x-archive'
		);
		agregarAccion(items, 'list-archive', 'fileBrowser.actions.listArchive', 'view-list-details');
		agregarAccion(items, 'compress', 'fileBrowser.actions.compress', 'application-x-archive');

		items.push({ type: 'separator' });

		if (isActionVisible('toggle-favorite')) {
			items.push(
				actionItem(
					'toggle-favorite',
					t(
						allSelectedAreFavorites.value
							? 'fileBrowser.actions.removeFromFavorites'
							: 'fileBrowser.actions.addToFavorites'
					),
					'emblem-favorite'
				)
			);
		}

		if (isActionVisible('edit-tags')) {
			items.push({
				type: 'submenu',
				label: t('fileBrowser.actions.tags'),
				icon: 'tag-symbolic',
				items: tagItems(),
			});
		}

		items.push({ type: 'separator' });

		agregarAccion(items, 'properties', 'fileBrowser.actions.properties', 'document-properties', {
			atajo: 'showProperties',
		});

		return tidySeparators(items);
	}

	async function toggleTag(tagId: string, entries: DirEntry[]) {
		const yaEstaba = selectedTagIds.value.includes(tagId);

		// Cada entrada es independiente: se etiquetan en paralelo.
		await Promise.all(
			entries.map((entry) =>
				yaEstaba
					? userStatsStore.removeTagFromItem(entry.path, tagId)
					: userStatsStore.addTagToItem(entry.path, tagId, entry.is_file)
			)
		);
	}

	async function openEntryContextMenu(entry: DirEntry, event: MouseEvent) {
		options.handleEntryContextMenu(entry);

		const entries = [...options.contextMenu.value.selectedEntries];
		if (entries.length === 0) return;

		// El punto se guarda antes de esperar: los programas asociados y las
		// terminales se piden al sistema, y para cuando contestan el evento ya
		// terminó. El menú del motor no aparece igual, lo apaga `setupContextMenu`
		// en toda la ventana.
		const punto = { x: event.clientX, y: event.clientY };

		const elegido = await show(await buildMenu(entries), punto);
		if (!elegido) return;

		if (elegido.id.startsWith('action:')) {
			options.onAction(elegido.id.slice('action:'.length) as ContextMenuAction);
			return;
		}

		if (elegido.id === 'open-with:custom') {
			options.openOpenWithDialog(entries);
			return;
		}

		if (elegido.id.startsWith('open-with:')) {
			await openWithProgram(elegido.id.slice('open-with:'.length), entries);
			return;
		}

		if (elegido.id.startsWith('terminal:')) {
			// Se lee antes de esperar la ruta: si se leyera después, soltar Shift
			// en ese intervalo cambiaría si la terminal abre como administrador,
			// y viceversa.
			const comoAdministrador = isShiftHeld.value;
			const destino = await terminalTargetPath(entries);
			if (!destino) return;

			await terminalsStore.openTerminal(
				destino,
				elegido.id.slice('terminal:'.length),
				comoAdministrador
			);
			return;
		}

		if (elegido.id.startsWith('tag:')) {
			await toggleTag(elegido.id.slice('tag:'.length), entries);
		}
	}

	return { openEntryContextMenu };
}
