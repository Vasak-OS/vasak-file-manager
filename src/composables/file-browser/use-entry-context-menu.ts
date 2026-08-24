import { invoke } from '@tauri-apps/api/core';
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

	/** La carpeta donde abrir la terminal: la seleccionada, o la que contiene al archivo. */
	const terminalTargetPath = computed(() => {
		const primera = selectedEntries.value[0];
		if (!primera) return null;
		if (primera.is_dir) return primera.path;

		const separador = Math.max(primera.path.lastIndexOf('/'), primera.path.lastIndexOf('\\'));

		return separador > 0 ? primera.path.substring(0, separador) : primera.path;
	});

	/** Los separadores sólo valen entre dos renglones: sueltos son una raya sola. */
	function tidySeparators(items: MenuEntry[]): MenuEntry[] {
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

	function actionItem(
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
		const items: MenuEntry[] = [];

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

		const porDefecto = resultado?.default_program ?? null;
		const recomendados = resultado?.recommended_programs ?? [];

		if (porDefecto) {
			items.push({ type: 'label', label: t('openWith.defaultApp') });
			items.push({
				id: `open-with:${porDefecto.path}`,
				label: porDefecto.name,
				icon: porDefecto.icon ?? 'text-x-generic',
			});
		}

		if (recomendados.length > 0) {
			if (porDefecto) items.push({ type: 'separator' });

			items.push({ type: 'label', label: t('openWith.suggestedApps') });

			for (const programa of recomendados) {
				items.push({
					id: `open-with:${programa.path}`,
					label: programa.name,
					icon: programa.icon ?? 'text-x-generic',
				});
			}
		}

		if (!porDefecto && recomendados.length === 0) {
			items.push({ type: 'label', label: t('openWith.noProgramsFound') });
		}

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

	async function buildMenu(entries: DirEntry[]): Promise<MenuEntry[]> {
		const items: MenuEntry[] = [];

		if (isActionVisible('rename')) {
			items.push(
				actionItem('rename', t('fileBrowser.actions.rename'), 'edit-rename', {
					accelerator: shortcutsStore.getShortcutLabel('rename'),
				})
			);
		}

		if (isActionVisible('copy')) {
			items.push(
				actionItem('copy', t('fileBrowser.actions.copy'), 'edit-copy', {
					accelerator: shortcutsStore.getShortcutLabel('copy'),
				})
			);
		}

		if (isActionVisible('cut')) {
			items.push(
				actionItem('cut', t('fileBrowser.actions.cut'), 'edit-cut', {
					accelerator: shortcutsStore.getShortcutLabel('cut'),
				})
			);
		}

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

		if (isActionVisible('open-in-new-tab')) {
			items.push(
				actionItem('open-in-new-tab', t('fileBrowser.actions.openInNewTab'), 'gtk-add', {
					accelerator: shortcutsStore.getShortcutLabel('openNewTab'),
				})
			);
		}

		if (isActionVisible('share')) {
			items.push(actionItem('share', t('fileBrowser.actions.share'), 'emblem-shared'));
		}

		if (isActionVisible('extract-here')) {
			items.push(
				actionItem('extract-here', t('fileBrowser.actions.extractHere'), 'application-x-archive')
			);
		}

		if (isActionVisible('compress')) {
			items.push(
				actionItem('compress', t('fileBrowser.actions.compress'), 'application-x-archive')
			);
		}

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

		return tidySeparators(items);
	}

	async function openWithProgram(programPath: string, entries: DirEntry[]) {
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

	async function toggleTag(tagId: string, entries: DirEntry[]) {
		const yaEstaba = selectedTagIds.value.includes(tagId);

		for (const entry of entries) {
			if (yaEstaba) {
				await userStatsStore.removeTagFromItem(entry.path, tagId);
			} else {
				await userStatsStore.addTagToItem(entry.path, tagId, entry.is_file);
			}
		}
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
			if (!terminalTargetPath.value) return;

			await terminalsStore.openTerminal(
				terminalTargetPath.value,
				elegido.id.slice('terminal:'.length),
				isShiftHeld.value
			);
			return;
		}

		if (elegido.id.startsWith('tag:')) {
			await toggleTag(elegido.id.slice('tag:'.length), entries);
		}
	}

	return { openEntryContextMenu };
}
