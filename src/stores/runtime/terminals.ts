import { invoke } from '@tauri-apps/api/core';
import { defineStore } from 'pinia';
import { ref } from 'vue';

interface TerminalInfo {
	id: string;
	name: string;
	icon: string | null;
	isDefault: boolean;
}

interface GetAvailableTerminalsResult {
	success: boolean;
	terminals: TerminalInfo[];
	error: string | null;
}

interface OpenTerminalResult {
	success: boolean;
	error: string | null;
}

export type { TerminalInfo };

export const useTerminalsStore = defineStore('terminals', () => {
	const terminals = ref<TerminalInfo[]>([]);
	const loadError = ref<string | null>(null);
	const hasLoaded = ref(false);

	/**
	 * El pedido en curso, si hay uno.
	 *
	 * El menú del clic derecho pide las terminales al armarse, y al montar la
	 * vista se piden también: dos pedidos en vuelo al mismo tiempo, y el que
	 * conteste último manda. Si ese último es el que falló, borra el resultado
	 * bueno del otro. Compartiendo el pedido, quien llegue segundo espera al
	 * primero en vez de largar otro.
	 */
	let enCurso: Promise<void> | null = null;

	async function init() {
		if (enCurso) return enCurso;

		enCurso = pedirTerminales().finally(() => {
			enCurso = null;
		});

		return enCurso;
	}

	async function pedirTerminales() {
		loadError.value = null;

		try {
			const result = await invoke<GetAvailableTerminalsResult>('get_available_terminals');

			if (result.success) {
				terminals.value = result.terminals;
				hasLoaded.value = true;
				loadIconsAsync();
			} else {
				loadError.value = result.error || 'Failed to load terminals';
				hasLoaded.value = true;
			}
		} catch (invokeError) {
			loadError.value = String(invokeError);
			hasLoaded.value = true;
		}
	}

	async function loadIconsAsync() {
		try {
			const iconsMap = await invoke<Record<string, string>>('get_terminal_icons');
			terminals.value = terminals.value.map((terminal) => ({
				...terminal,
				icon: iconsMap[terminal.id] ?? terminal.icon,
			}));
		} catch (iconError) {
			console.error('Failed to load terminal icons:', iconError);
		}
	}

	async function openTerminal(directoryPath: string, terminalId: string, asAdmin: boolean) {
		try {
			const result = await invoke<OpenTerminalResult>('open_terminal', {
				directoryPath,
				terminalId,
				asAdmin,
			});

			if (!result.success) {
				console.error('Failed to open terminal:', result.error);
			}
		} catch (invokeError) {
			console.error('Failed to open terminal:', invokeError);
		}
	}

	return {
		terminals,
		loadError,
		hasLoaded,
		init,
		openTerminal,
	};
});
