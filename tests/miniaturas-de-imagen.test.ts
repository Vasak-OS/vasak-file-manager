/**
 * Las imágenes grandes de la grilla pasan por miniatura.
 *
 * La tarjeta dibujaba `<img src=la imagen entera>` a 120 px de alto, pero
 * WebKit decodifica a tamaño real: seis fondos de pantalla (14 MB en disco)
 * eran ~480 MiB en el proceso web, contra ~230 con la misma carpeta en lista.
 * Ahora las grandes piden su miniatura al backend, como los videos; las chicas
 * y los SVG, que no pesan, siguen cargándose directo.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, nextTick, ref } from 'vue';
import {
	FILE_BROWSER_CONTEXT_KEY,
	type FileBrowserContext,
} from '@/composables/file-browser/use-file-browser-context';
import type { DirEntry } from '@/types/dir-entry';
import { needsThumbnail } from '@/utils/files';
import FileBrowserGridView from '@/views/filebrowser/FileBrowserGridView.vue';
import { olvidarTodo, responder } from './dobles';

function entry(name: string, size: number): DirEntry {
	return {
		name,
		path: `/casa/${name}`,
		is_dir: false,
		is_file: true,
		is_hidden: false,
		size,
		ext: name.split('.').pop() ?? null,
		item_count: null,
	} as DirEntry;
}

const MIB = 1024 * 1024;
const BIG = entry('fondo.png', 3 * MIB);
const SMALL = entry('icono.png', 10 * 1024);
const VECTOR = entry('logo.svg', 3 * MIB);
const THUMB = 'vasak://localhost/miniatura-del-fondo.png';

const asked: string[] = [];

function buildContext(entries: DirEntry[], thumbnail: string | undefined): FileBrowserContext {
	return {
		entries: computed(() => entries),
		currentPath: computed(() => '/casa'),
		isLoading: ref(false),
		isDirectoryEmpty: computed(() => false),
		error: ref(null),
		selectedEntries: ref([]),
		isEntrySelected: () => false,
		contextMenu: ref({
			visible: false,
			x: 0,
			y: 0,
			entry: null,
		}) as FileBrowserContext['contextMenu'],
		getVideoThumbnail: (e) => {
			asked.push(e.path);
			return thumbnail;
		},
		setEntriesContainerRef: () => {},
		registrarSeccionesVisuales: () => {},
		registrarDesplazamiento: () => {},
		onEntryMouseDown: () => {},
		onEntryMouseUp: () => {},
		openEntryContextMenu: () => {},
		onContextMenuAction: () => {},
		openOpenWithDialog: () => {},
		navigateToHome: () => {},
	};
}

/** En el DOM de las pruebas todo mide cero y el desplazador no dibuja nada. */
function withViewportHeight(height: number) {
	const rectangle = Element.prototype.getBoundingClientRect;
	Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
	Element.prototype.getBoundingClientRect = () =>
		({ top: 0, left: 0, bottom: height, right: 900, width: 900, height, x: 0, y: 0 }) as DOMRect;
	return () => {
		Element.prototype.getBoundingClientRect = rectangle;
	};
}

async function srcsOfCard(entries: DirEntry[], thumbnail: string | undefined, path: string) {
	const restore = withViewportHeight(900);
	const wrapper: VueWrapper = mount(FileBrowserGridView, {
		props: { entries },
		global: { provide: { [FILE_BROWSER_CONTEXT_KEY as symbol]: buildContext(entries, thumbnail) } },
		attachTo: document.body,
	});
	try {
		for (let step = 0; step < 12; step++) await nextTick();
		const card = wrapper.find(`[data-entry-path="${path}"]`);
		expect(card.exists()).toBe(true);
		return card.findAll('img').map((img) => img.attributes('src'));
	} finally {
		wrapper.unmount();
		restore();
	}
}

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	asked.length = 0;
	responder('get_active_calculations', []);
});

describe('qué imágenes pasan por miniatura', () => {
	test.each([
		['fondo.png', 3 * MIB, true],
		['foto.JPG', 3 * MIB, true],
		['foto.webp', 256 * 1024, true],
		['casi.png', 256 * 1024 - 1, false],
		['icono.png', 10 * 1024, false],
		// El SVG se dibuja a la medida que se le pide: no pesa por su tamaño.
		['logo.svg', 3 * MIB, false],
		// Lo que el backend no sabe achicar se carga directo.
		['raro.avif', 3 * MIB, false],
		['clip.mp4', 3 * MIB, false],
	])('%s de %d bytes -> %s', (name, size, expected) => {
		expect(needsThumbnail(entry(name, size))).toBe(expected);
	});

	test('una carpeta no', () => {
		expect(needsThumbnail({ ...BIG, is_dir: true } as DirEntry)).toBe(false);
	});
});

describe('la tarjeta de imagen de la cuadrícula', () => {
	test('una imagen grande dibuja su miniatura y no la imagen entera', async () => {
		const srcs = await srcsOfCard([BIG], THUMB, BIG.path);

		expect(srcs).toEqual([THUMB]);
		expect(asked).toContain(BIG.path);
	});

	test('mientras la miniatura no llega no se carga la imagen entera', async () => {
		// Es lo que pesaba: una `<img>` con la ruta del original, aunque se
		// dibujara chica.
		const srcs = await srcsOfCard([BIG], undefined, BIG.path);

		expect(srcs).toEqual([]);
	});

	test.each([
		['una imagen chica', SMALL],
		['un SVG', VECTOR],
	])('%s se carga directo y no pide miniatura', async (_caso, directa) => {
		const srcs = await srcsOfCard([directa], THUMB, directa.path);

		expect(srcs).toHaveLength(1);
		expect(srcs[0]).toContain(directa.name);
		expect(asked).not.toContain(directa.path);
	});
});
