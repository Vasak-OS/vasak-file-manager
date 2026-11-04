import { LazyStore } from '@tauri-apps/plugin-store';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useUserPathsStore } from './user-paths';

export type TextSize = 'small' | 'medium' | 'large';

interface UserSettingsState {
	/** Reduce el movimiento aunque el SO no lo pida (se suma a `prefers-reduced-motion`). */
	reduceMotion: boolean;
	/** Apaga animaciones y filtros de composición para equipos sin aceleración. */
	lowPower: boolean;
	textSize: TextSize;
}

const DEFAULTS: UserSettingsState = {
	reduceMotion: false,
	lowPower: false,
	textSize: 'medium',
};

// El tamaño de texto mueve el `font-size` de la raíz. Los tokens de tipografía
// de vue-libvasak están en `rem`, así que toda la interfaz escala con él.
const FONT_SIZE_PX: Record<TextSize, string> = {
	small: '14px',
	medium: '16px',
	large: '18px',
};

/**
 * Ajustes del gestor (reduce-motion, bajo consumo, tamaño de texto).
 *
 * Son preferencias propias de la app, no config global del sistema: se guardan
 * con el Tauri Store en `user-settings.json`, igual que el layout. `isOpen` es
 * el estado de la vista overlay y no se persiste.
 */
export const useUserSettingsStore = defineStore('userSettings', () => {
	const userPathsStore = useUserPathsStore();
	const storage = ref<LazyStore | null>(null);
	const settings = ref<UserSettingsState>({ ...DEFAULTS });
	const isOpen = ref(false);

	const reduceMotion = computed(() => settings.value.reduceMotion);
	const lowPower = computed(() => settings.value.lowPower);
	const textSize = computed(() => settings.value.textSize);

	// Vuelca el estado al documento: clases para el movimiento y el bajo consumo
	// (las reglas viven en main.css), y el `font-size` de la raíz para el tamaño.
	function apply() {
		const root = document.documentElement;
		root.classList.toggle('reduce-motion', settings.value.reduceMotion);
		root.classList.toggle('low-power', settings.value.lowPower);
		root.style.fontSize = FONT_SIZE_PX[settings.value.textSize];
	}

	async function initStorage() {
		try {
			if (!storage.value) {
				storage.value = new LazyStore(userPathsStore.customPaths.appUserDataSettingsPath);
				await storage.value.save();
			}
		} catch (error) {
			console.error('Failed to initialize user settings storage:', error);
		}
	}

	async function load() {
		try {
			const stored = await storage.value?.get<Partial<UserSettingsState>>('settings');
			if (stored) {
				settings.value = { ...DEFAULTS, ...stored };
			}
		} catch (error) {
			console.error('Failed to load user settings:', error);
		}
	}

	async function save() {
		try {
			if (storage.value) {
				await storage.value.set('settings', settings.value);
				await storage.value.save();
			}
		} catch (error) {
			console.error('Failed to save user settings:', error);
		}
	}

	async function update(patch: Partial<UserSettingsState>) {
		settings.value = { ...settings.value, ...patch };
		apply();
		await save();
	}

	async function init() {
		await initStorage();
		await load();
		apply();
	}

	function open() {
		isOpen.value = true;
	}

	function close() {
		isOpen.value = false;
	}

	return {
		settings,
		reduceMotion,
		lowPower,
		textSize,
		isOpen,
		init,
		update,
		apply,
		open,
		close,
	};
});
