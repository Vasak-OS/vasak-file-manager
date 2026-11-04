/**
 * La pantalla de Ajustes del gestor (#153).
 *
 * Tres puntas, cada una de las cuales puede cortarse sin ningún error: el
 * store que guarda y vuelca al documento las preferencias, la vista que las
 * cambia, y el cableado (botón de la barra lateral, exclusión mutua con la
 * búsqueda y la papelera, Escape).
 *
 * El respaldo de `@tauri-apps/plugin-store` es un `Map` detrás del doble de
 * `invoke`.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { SegmentedControl, SideButton, SwitchRow } from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, getActivePinia, type Pinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick, ref } from 'vue';
import NavigatorBarComponent from '@/components/navigator/NavigatorBarComponent.vue';
import SidebarComponent from '@/components/sidebar/SidebarComponent.vue';
import { WINDOW_COLUMNS_KEY, type WindowColumns } from '@/composables/use-window-columns';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useTrashStore } from '@/stores/runtime/trash';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useUserSettingsStore } from '@/stores/storage/user-settings';
import SettingsView from '@/views/SettingsView.vue';
import { olvidarTodo, pedidos, responder } from './dobles';

const disco = new Map<string, unknown>();
const RUTA = '/datos/user-settings.json';

async function asentar(vueltas = 8) {
	for (let i = 0; i < vueltas; i++) {
		await nextTick();
		await new Promise((sigue) => setTimeout(sigue, 0));
	}
}

const montadas: VueWrapper[] = [];

beforeEach(() => {
	olvidarTodo();
	disco.clear();
	responder('plugin:store|load', 1);
	responder('plugin:store|save', undefined);
	responder('plugin:store|set', ({ key, value }) => {
		disco.set(key as string, JSON.parse(JSON.stringify(value)));
	});
	responder('plugin:store|get', ({ key }) => [disco.get(key as string), disco.has(key as string)]);
	responder('list_trash', []);
	responder('get_active_calculations', []);
	responder('get_system_drives', []);
	responder('list_cloud_drives', []);
	const root = document.documentElement;
	root.classList.remove('reduce-motion', 'low-power');
	root.style.fontSize = '';
});

afterEach(() => {
	while (montadas.length) montadas.pop()?.unmount();
});

function nuevoStore() {
	setActivePinia(createPinia());
	useUserPathsStore().customPaths.appUserDataSettingsPath = RUTA;
	return useUserSettingsStore();
}

const raiz = () => document.documentElement;

describe('el store de ajustes', () => {
	test('arranca con los valores por omisión', () => {
		const store = nuevoStore();
		expect(store.settings).toEqual({ reduceMotion: false, lowPower: false, textSize: 'medium' });
		expect(store.isOpen).toBe(false);
	});

	test('init crea el almacén en la ruta de ajustes y aplica lo guardado', async () => {
		disco.set('settings', { reduceMotion: true, lowPower: false, textSize: 'large' });
		const store = nuevoStore();

		await store.init();

		expect(
			pedidos('plugin:store|load').some((p) => JSON.stringify(p.argumentos).includes(RUTA))
		).toBe(true);
		expect(store.reduceMotion).toBe(true);
		expect(raiz().classList.contains('reduce-motion')).toBe(true);
		expect(raiz().classList.contains('low-power')).toBe(false);
		expect(raiz().style.fontSize).toBe('18px');
	});

	test('un guardado parcial se completa con los valores por omisión', async () => {
		disco.set('settings', { lowPower: true });
		const store = nuevoStore();

		await store.init();

		expect(store.settings).toEqual({ reduceMotion: false, lowPower: true, textSize: 'medium' });
		expect(raiz().style.fontSize).toBe('16px');
	});

	test('un valor guardado con el tipo equivocado cae al valor por omisión', async () => {
		disco.set('settings', { reduceMotion: 'false', textSize: 'huge', lowPower: 1 });
		const store = nuevoStore();

		await store.init();

		expect(store.settings).toEqual({ reduceMotion: false, lowPower: false, textSize: 'medium' });
		expect(raiz().classList.contains('reduce-motion')).toBe(false);
		expect(raiz().classList.contains('low-power')).toBe(false);
		expect(raiz().style.fontSize).toBe('16px');
	});

	test('apply deja en localStorage la caché que lee el script de arranque', async () => {
		const guardado: Record<string, string> = {};
		const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			value: {
				getItem: (k: string) => guardado[k] ?? null,
				setItem: (k: string, v: string) => {
					guardado[k] = v;
				},
			},
		});
		try {
			const store = nuevoStore();
			await store.init();
			await store.update({ lowPower: true, textSize: 'large' });

			expect(JSON.parse(guardado['vsk-settings'])).toEqual({
				reduceMotion: false,
				lowPower: true,
				textSize: 'large',
			});
		} finally {
			if (original) Object.defineProperty(globalThis, 'localStorage', original);
			else Reflect.deleteProperty(globalThis, 'localStorage');
		}
	});

	test('sin nada guardado se queda con los valores por omisión', async () => {
		const store = nuevoStore();
		await store.init();
		expect(store.settings).toEqual({ reduceMotion: false, lowPower: false, textSize: 'medium' });
	});

	test('apply pone y saca cada clase y el tamaño de texto que toca', () => {
		const store = nuevoStore();
		const tamanos = { small: '14px', medium: '16px', large: '18px' } as const;
		for (const reduceMotion of [true, false]) {
			for (const lowPower of [true, false]) {
				for (const [textSize, px] of Object.entries(tamanos)) {
					store.settings = { reduceMotion, lowPower, textSize: textSize as 'small' };
					store.apply();
					expect(raiz().classList.contains('reduce-motion')).toBe(reduceMotion);
					expect(raiz().classList.contains('low-power')).toBe(lowPower);
					expect(raiz().style.fontSize).toBe(px);
				}
			}
		}
	});

	test('update aplica al documento y persiste con set y save', async () => {
		const store = nuevoStore();
		await store.init();
		olvidarSets();

		await store.update({ lowPower: true, textSize: 'small' });

		expect(raiz().classList.contains('low-power')).toBe(true);
		expect(raiz().style.fontSize).toBe('14px');
		expect(disco.get('settings')).toEqual({
			reduceMotion: false,
			lowPower: true,
			textSize: 'small',
		});
		expect(pedidos('plugin:store|set').at(-1)?.argumentos.key).toBe('settings');
		expect(pedidos('plugin:store|save').length).toBeGreaterThan(0);
	});

	test('lo guardado sobrevive a reabrir la aplicación', async () => {
		await (async () => {
			const primera = nuevoStore();
			await primera.init();
			await primera.update({ reduceMotion: true });
		})();
		raiz().classList.remove('reduce-motion');

		const segunda = nuevoStore();
		await segunda.init();

		expect(segunda.reduceMotion).toBe(true);
		expect(raiz().classList.contains('reduce-motion')).toBe(true);
	});

	test('abrir y cerrar sólo mueven isOpen y no se guardan', async () => {
		const store = nuevoStore();
		await store.init();
		store.open();
		expect(store.isOpen).toBe(true);
		store.close();
		expect(store.isOpen).toBe(false);
		await store.update({});
		expect(JSON.stringify(disco.get('settings'))).not.toContain('isOpen');
	});

	test('si el almacén falla, init no rompe y deja los valores por omisión', async () => {
		const error = spyOn(console, 'error').mockImplementation(() => {});
		responder('plugin:store|load', () => {
			throw new Error('sin disco');
		});
		const store = nuevoStore();

		await store.init();
		await store.update({ lowPower: true });

		expect(store.lowPower).toBe(true);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});
});

function olvidarSets() {
	disco.delete('settings');
}

describe('la vista de ajustes', () => {
	function abrirLaVista() {
		const store = nuevoStore();
		const vista = mount(SettingsView, { global: { plugins: [getActivePinia() as Pinia] } });
		montadas.push(vista);
		return { vista, store };
	}

	test('el interruptor de reducir movimiento actualiza reduceMotion', async () => {
		const { vista, store } = abrirLaVista();
		vista.findAllComponents(SwitchRow)[0].vm.$emit('update:modelValue', true);
		expect(store.settings).toEqual({ reduceMotion: true, lowPower: false, textSize: 'medium' });
	});

	test('el interruptor de bajo consumo actualiza lowPower', async () => {
		const { vista, store } = abrirLaVista();
		vista.findAllComponents(SwitchRow)[1].vm.$emit('update:modelValue', true);
		expect(store.settings).toEqual({ reduceMotion: false, lowPower: true, textSize: 'medium' });
	});

	test('el control segmentado actualiza textSize', async () => {
		const { vista, store } = abrirLaVista();
		vista.findComponent(SegmentedControl).vm.$emit('update:modelValue', 'large');
		expect(store.settings).toEqual({ reduceMotion: false, lowPower: false, textSize: 'large' });
		expect(raiz().style.fontSize).toBe('18px');
	});

	test('el control segmentado ofrece los tres tamaños', () => {
		const { vista } = abrirLaVista();
		const opciones = vista.findComponent(SegmentedControl).props('options') as Array<{
			value: string;
		}>;
		expect(opciones.map((o) => o.value)).toEqual(['small', 'medium', 'large']);
	});

	test('un valor nulo del control segmentado no actualiza nada', async () => {
		const { vista, store } = abrirLaVista();
		vista.findComponent(SegmentedControl).vm.$emit('update:modelValue', null);
		expect(store.settings.textSize).toBe('medium');
		expect(pedidos('plugin:store|set')).toHaveLength(0);
	});

	test('el botón de cerrar emite close', async () => {
		const { vista } = abrirLaVista();
		await vista.find('button').trigger('click');
		expect(vista.emitted('close')).toHaveLength(1);
	});
});

describe('el sidebar', () => {
	test('el botón Ajustes abre la vista sin tocar la papelera', async () => {
		const pinia = createPinia();
		setActivePinia(pinia);
		const settings = useUserSettingsStore();
		const vista = mount(SidebarComponent, { global: { plugins: [pinia] } });
		montadas.push(vista);
		await asentar();
		const boton = vista
			.findAllComponents(SideButton)
			.find((b) => b.props('label') === 'settings.title');

		expect(boton?.props('icon')).toBe('preferences-system');
		await boton?.trigger('click');

		expect(settings.isOpen).toBe(true);
		expect(useTrashStore().isOpen).toBe(false);
	});
});

describe('el sidebar en una ventana compacta', () => {
	test('el botón Ajustes cierra el cajón y abre la vista', async () => {
		const pinia = createPinia();
		setActivePinia(pinia);
		const settings = useUserSettingsStore();
		const columnas: WindowColumns = {
			width: ref(300),
			isOneColumn: ref(true),
			isCompact: ref(true),
			column: ref('files'),
			isSidebarOpen: ref(true),
		};
		const vista = mount(SidebarComponent, {
			global: { plugins: [pinia], provide: { [WINDOW_COLUMNS_KEY as symbol]: columnas } },
		});
		montadas.push(vista);
		await asentar();

		await vista
			.findAllComponents(SideButton)
			.find((b) => b.props('label') === 'settings.title')
			?.trigger('click');

		expect(columnas.isSidebarOpen.value).toBe(false);
		expect(settings.isOpen).toBe(true);
	});
});

describe('la barra del navegador', () => {
	function barra(panel: Record<string, unknown> = {}) {
		const pinia = createPinia();
		setActivePinia(pinia);
		const vista = mount(NavigatorBarComponent, {
			global: {
				plugins: [pinia],
				stubs: {
					FileBrowserComponent: panel.deleteItems
						? defineComponent({
								name: 'PanelDoble',
								template: '<div />',
								methods: { deleteItems: panel.deleteItems as () => void },
							})
						: true,
					GlobalSearchView: true,
					ClipboardToolbarComponent: true,
				},
			},
		});
		montadas.push(vista);
		return vista;
	}
	const apretarEscape = async () =>
		await useShortcutsStore().handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

	test('monta la vista y la muestra sólo mientras está abierta', async () => {
		const vista = barra();
		const ajustes = vista.findComponent(SettingsView);
		expect(ajustes.element.style.display).toBe('none');

		useUserSettingsStore().open();
		await asentar(2);
		expect(ajustes.element.style.display).not.toBe('none');
	});

	test('la cruz de la vista la cierra', async () => {
		const vista = barra();
		const store = useUserSettingsStore();
		store.open();
		vista.findComponent(SettingsView).vm.$emit('close');
		await asentar(2);
		expect(store.isOpen).toBe(false);
	});

	test('Escape cierra los ajustes', async () => {
		barra();
		const store = useUserSettingsStore();
		store.open();
		await asentar(2);

		expect(await apretarEscape()).toBe(true);

		expect(store.isOpen).toBe(false);
	});

	test('abrir los ajustes cierra la búsqueda y la papelera', async () => {
		barra();
		const busqueda = useGlobalSearchStore();
		await busqueda.open();
		await asentar(2);
		await useTrashStore().open();
		await asentar(2);

		useUserSettingsStore().open();
		await asentar(2);

		expect(useUserSettingsStore().isOpen).toBe(true);
		expect(busqueda.isOpen).toBe(false);
		expect(useTrashStore().isOpen).toBe(false);
	});

	test('abrir la búsqueda cierra los ajustes', async () => {
		barra();
		const store = useUserSettingsStore();
		store.open();
		await asentar(2);

		await useGlobalSearchStore().open();
		await asentar(2);

		expect(store.isOpen).toBe(false);
	});

	test('abrir la papelera cierra los ajustes', async () => {
		barra();
		const store = useUserSettingsStore();
		store.open();
		await asentar(2);

		await useTrashStore().open();
		await asentar(2);

		expect(store.isOpen).toBe(false);
	});

	describe('Supr y Mayús+Supr', () => {
		async function conSeleccion() {
			const deleteItems = mock(async () => {});
			const vista = barra({ deleteItems });
			// La selección llega como la manda el panel: por su evento.
			vista
				.findComponent({ name: 'PanelDoble' })
				.vm.$emit('update:selected-entries', [{ name: 'a.txt', path: '/a.txt' }]);
			await asentar(2);

			return deleteItems;
		}
		const supr = async (shiftKey: boolean) =>
			await useShortcutsStore().handleKeydown(
				new KeyboardEvent('keydown', { key: 'Delete', shiftKey })
			);

		test('con los ajustes cerrados siguen borrando la selección', async () => {
			const deleteItems = await conSeleccion();

			await supr(false);
			await supr(true);

			expect(deleteItems.mock.calls.map((c) => (c as unknown[])[1])).toEqual([true, false]);
		});

		test('con los ajustes abiertos no borran la selección oculta', async () => {
			const deleteItems = await conSeleccion();
			useUserSettingsStore().open();
			await asentar(2);

			await supr(false);
			await supr(true);

			expect(deleteItems).not.toHaveBeenCalled();
		});
	});
});
