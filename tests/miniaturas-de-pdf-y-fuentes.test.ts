/**
 * Los PDF y las fuentes de la grilla dibujan la miniatura que genera el backend.
 *
 * Antes la tarjeta de «otros» sólo mostraba el icono. Ahora un PDF o una fuente
 * (`.ttf`/`.otf`, lo que `video_thumbnail` sabe dibujar) pide su miniatura; el
 * resto de los archivos no la pide, y si la miniatura no está o falló, la tarjeta
 * conserva el icono.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, nextTick, ref } from 'vue';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import {
	FILE_BROWSER_CONTEXT_KEY,
	type FileBrowserContext,
} from '@/composables/file-browser/use-file-browser-context';
import { FILE_EXTENSIONS } from '@/constants/file-extensions';
import type { DirEntry } from '@/types/dir-entry';
import { isFontFile, isPdfFile } from '@/utils/files';
import FileBrowserGridView from '@/views/filebrowser/FileBrowserGridView.vue';
import { olvidarTodo, responder } from './dobles';
import { archivo, carpeta } from './support/dir-entry';

const THUMB = 'vasak://localhost/miniatura.png';

const PDF = archivo('manual.pdf', { ext: 'pdf', size: 40_000 });
const FUENTE = archivo('letra.ttf', { ext: 'ttf', size: 40_000 });
const FUENTE_OTF = archivo('letra.OTF', { ext: 'OTF', size: 40_000 });
const TEXTO = archivo('notas.txt', { ext: 'txt' });
const ZIP = archivo('copia.zip', { ext: 'zip' });

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

/** Monta la grilla y devuelve lo que dibujó la tarjeta de `entry`. */
async function cardOf(entries: DirEntry[], thumbnail: string | undefined, entry: DirEntry) {
	const restore = withViewportHeight(900);
	const wrapper: VueWrapper = mount(FileBrowserGridView, {
		props: { entries },
		global: { provide: { [FILE_BROWSER_CONTEXT_KEY as symbol]: buildContext(entries, thumbnail) } },
		attachTo: document.body,
	});
	try {
		for (let step = 0; step < 12; step++) await nextTick();
		const card = wrapper.find(`[data-entry-path="${entry.path}"]`);
		expect(card.exists()).toBe(true);
		return {
			srcs: card.findAll('img').map((img) => img.attributes('src')),
			hasIcon: card.findComponent(EntryIconComponent).exists(),
		};
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

describe('qué archivos son una fuente', () => {
	test.each([
		['letra.ttf', 'ttf', true],
		['letra.otf', 'otf', true],
		['LETRA.TTF', 'TTF', true],
		['letra.OTF', 'OTF', true],
		// Límite declarado: el backend sólo dibuja ttf y otf.
		['letra.woff', 'woff', false],
		['letra.woff2', 'woff2', false],
		['letra.ttc', 'ttc', false],
		['notas.txt', 'txt', false],
	])('%s -> %s', (name, ext, expected) => {
		expect(isFontFile(archivo(name, { ext }))).toBe(expected);
	});

	test('sin extensión no es una fuente', () => {
		expect(isFontFile(archivo('letra', { ext: null }))).toBe(false);
	});

	test('una carpeta llamada como una fuente no lo es', () => {
		expect(isFontFile(carpeta('letra.ttf', { ext: 'ttf' }))).toBe(false);
	});

	test('el grupo FONT declara sólo lo que el backend sabe dibujar', () => {
		expect([...FILE_EXTENSIONS.FONT].sort()).toEqual(['otf', 'ttf']);
	});

	test('un PDF no es una fuente ni una fuente es un PDF', () => {
		expect(isPdfFile(PDF)).toBe(true);
		expect(isFontFile(PDF)).toBe(false);
		expect(isPdfFile(FUENTE)).toBe(false);
	});
});

describe('la tarjeta de «otros» de la cuadrícula', () => {
	test.each([
		['un PDF', PDF],
		['una fuente .ttf', FUENTE],
		['una fuente con extensión en mayúsculas', FUENTE_OTF],
	])('%s dibuja su miniatura y la pide al backend', async (_caso, entrada) => {
		const { srcs, hasIcon } = await cardOf([entrada], THUMB, entrada);

		expect(srcs).toEqual([THUMB]);
		expect(hasIcon).toBe(false);
		expect(asked).toContain(entrada.path);
	});

	test.each([
		['un txt', TEXTO],
		['un zip', ZIP],
	])('%s no pide miniatura y conserva el icono', async (_caso, entrada) => {
		const { srcs, hasIcon } = await cardOf([PDF, FUENTE, entrada], THUMB, entrada);

		expect(srcs).toEqual([]);
		expect(hasIcon).toBe(true);
		expect(asked).not.toContain(entrada.path);
	});

	test.each([
		['un PDF', PDF],
		['una fuente', FUENTE],
	])('si la miniatura de %s no está, queda el icono', async (_caso, entrada) => {
		const { srcs, hasIcon } = await cardOf([entrada], undefined, entrada);

		expect(srcs).toEqual([]);
		expect(hasIcon).toBe(true);
		expect(asked).toContain(entrada.path);
	});
});
