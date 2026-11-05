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
	// Los cambios que el usuario hizo antes de que `init()` terminara. La vista se
	// abre desde la barra lateral, que se dibuja antes de que `init()` corra (en
	// onMounted, tras los stores de rutas y layout): un cambio en esa ventana de
	// milisegundos no debe perderse ni ser pisado por lo que `load()` lee del
	// disco. Se guardan por campo y se reaplican sobre lo cargado, así el resto de
	// lo guardado —los campos que el usuario no tocó— sobrevive.
	let pendientes: Partial<UserSettingsState> = {};

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
		// Caché para el script pre-boot de `index.html`: reaplica estas
		// preferencias antes de que monte Vue, así la ventana no abre con la
		// tipografía y el movimiento por omisión y salta al cargar (igual que el
		// tema). Si falla, se aplica igual al terminar `init`.
		try {
			localStorage.setItem('vsk-settings', JSON.stringify(settings.value));
		} catch {
			// localStorage puede no estar disponible; no es crítico.
		}
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
				// Se valida campo por campo, no con un spread: un archivo corrupto
				// con `"reduceMotion": "false"` (string) sería truthy en
				// `classList.toggle` y prendería la clase, y un `textSize` fuera del
				// enum dejaría `FONT_SIZE_PX[...]` en `undefined`. El disco es una
				// frontera: lo que no es válido cae al default.
				settings.value = {
					reduceMotion:
						typeof stored.reduceMotion === 'boolean' ? stored.reduceMotion : DEFAULTS.reduceMotion,
					lowPower: typeof stored.lowPower === 'boolean' ? stored.lowPower : DEFAULTS.lowPower,
					textSize:
						stored.textSize === 'small' ||
						stored.textSize === 'medium' ||
						stored.textSize === 'large'
							? stored.textSize
							: DEFAULTS.textSize,
				};
			}
		} catch (error) {
			console.error('Failed to load user settings:', error);
		}
		// Lo que el usuario cambió antes de que esto cargara manda sobre lo guardado,
		// pero sólo en sus campos: se reaplica encima para no perder su cambio ni
		// pisar el resto del disco.
		if (Object.keys(pendientes).length > 0) {
			settings.value = { ...settings.value, ...pendientes };
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
		pendientes = { ...pendientes, ...patch };
		settings.value = { ...settings.value, ...patch };
		apply();
		await save();
	}

	async function init() {
		await initStorage();
		await load();
		// Si el usuario cambió algo antes de que el almacén estuviera listo, su
		// `save()` no pudo persistir (storage era null): se guarda ahora el estado
		// ya combinado (lo cargado + sus cambios).
		if (Object.keys(pendientes).length > 0) await save();
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
