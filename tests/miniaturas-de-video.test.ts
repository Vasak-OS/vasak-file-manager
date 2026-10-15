/**
 * La miniatura de un video, resuelta una sola vez por tarjeta.
 *
 * `ctx.getVideoThumbnail(entry)` no es un captador barato: lee el `ref`
 * reactivo de miniaturas, consulta los conjuntos de «en curso» y «fallados» y,
 * cuando no hay nada cacheado, encola la generación con ffmpeg. La tarjeta de
 * video de la cuadrícula lo llamaba **cuatro veces por dibujado** sin miniatura
 * —los dos `v-if` de las capas, el `:class` del marco y el `v-if` de la
 * imagen— y cinco cuando ya estaba; cada llamada repetía toda esa lectura.
 *
 * Ahora la tarjeta va envuelta en `VideoThumbnailComponent`, que resuelve la
 * miniatura una sola vez por instancia con un `computed`. Estas pruebas fijan
 * las dos mitades de eso: que se resuelva una vez por tarjeta dibujada, y que
 * el marcado que sale sea exactamente el de antes —el componente no dibuja
 * nada, así que no puede aparecer ni un elemento de más—.
 *
 * La cuadrícula está virtualizada con `RecycleScroller`, y el desplazador
 * vuelve a montar sus vistas en más de un pase al asentarse. Por eso la cuenta
 * no se fija en un número —«dos», «cuatro»— sino que se compara contra cuántas
 * veces se dibujó cada tarjeta: lo que tiene que valer es **una llamada por
 * tarjeta dibujada**, sin importar cuántos pases dé el desplazador.
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
import FileBrowserGridView from '@/views/filebrowser/FileBrowserGridView.vue';
import { olvidarTodo, responder } from './dobles';

const FIRST_CLIP = '/casa/clip-uno.mp4';

const videos: DirEntry[] = [
	{
		name: 'clip-uno.mp4',
		path: FIRST_CLIP,
		is_dir: false,
		is_file: true,
		is_hidden: false,
		size: 2048,
		ext: 'mp4',
		item_count: null,
	} as DirEntry,
	{
		name: 'clip-dos.webm',
		path: '/casa/clip-dos.webm',
		is_dir: false,
		is_file: true,
		is_hidden: false,
		size: 4096,
		ext: 'webm',
		item_count: null,
	} as DirEntry,
];

/** Cuántas veces se leyó la miniatura, por ruta. */
const calls = new Map<string, number>();

function record(path: string): void {
	calls.set(path, (calls.get(path) ?? 0) + 1);
}

function buildContext(withThumbnail: boolean): FileBrowserContext {
	return {
		entries: computed(() => videos),
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
		getVideoThumbnail: (entry) => {
			record(entry.path);
			return withThumbnail ? `vasak://localhost/${encodeURIComponent(entry.path)}` : undefined;
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

/**
 * Un alto de verdad para que el desplazador dibuje.
 *
 * En modo página el desplazador decide qué filas dibujar comparando su
 * rectángulo con el alto de la ventana, y en el DOM de las pruebas todo mide
 * cero: sin esto no dibuja ninguna tarjeta y las pruebas no tendrían nada que
 * mirar.
 */
function withViewportHeight(height: number) {
	const rectangle = Element.prototype.getBoundingClientRect;
	const descriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
	Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
	Element.prototype.getBoundingClientRect = () =>
		({
			top: 0,
			left: 0,
			bottom: height,
			right: 900,
			width: 900,
			height: height,
			x: 0,
			y: 0,
		}) as DOMRect;
	return () => {
		Element.prototype.getBoundingClientRect = rectangle;
		if (descriptor) Object.defineProperty(window, 'innerHeight', descriptor);
		else Reflect.deleteProperty(window, 'innerHeight');
	};
}

/**
 * Monta la cuadrícula con sólo entradas de video. No espera: el asentamiento
 * del desplazador es parte de lo que cuentan las pruebas.
 */
function mountGrid(withThumbnail: boolean) {
	return mount(FileBrowserGridView, {
		props: { entries: videos },
		global: { provide: { [FILE_BROWSER_CONTEXT_KEY as symbol]: buildContext(withThumbnail) } },
		attachTo: document.body,
	});
}

/**
 * Cuántas veces se dibujó cada tarjeta.
 *
 * Cada pase del desplazador monta una tarjeta nueva, así que su elemento del
 * DOM es distinto; se recogen en un conjunto por ruta. Muestrear en cada vuelta
 * alcanza: el elemento vive hasta el próximo montaje, y ahí sí se vuelve a
 * contar.
 */
async function drawnCards(wrapper: VueWrapper, steps = 12): Promise<Map<string, Set<Element>>> {
	const cards = new Map<string, Set<Element>>();

	for (let step = 0; step < steps; step++) {
		await nextTick();

		for (const button of wrapper.findAll('[data-entry-path]')) {
			const path = button.attributes('data-entry-path') ?? '';
			const drawn = cards.get(path) ?? new Set<Element>();
			drawn.add(button.element);
			cards.set(path, drawn);
		}
	}

	return cards;
}

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	calls.clear();
	// El almacén de tamaños pregunta al arrancar qué cálculos quedaron en curso.
	responder('get_active_calculations', []);
});

describe('la miniatura de una tarjeta de video', () => {
	test.each([
		['todavía no hay miniatura', false],
		['ya hay miniatura', true],
	])('se resuelve una vez por tarjeta dibujada, %s', async (_case, withThumbnail) => {
		const restore = withViewportHeight(900);
		let wrapper: VueWrapper | null = null;

		try {
			wrapper = mountGrid(withThumbnail);
			const drawn = await drawnCards(wrapper);

			// Que de verdad haya tarjetas: sin esto, cero llamadas contra cero
			// elementos pasaría sin probar nada.
			expect(drawn.size).toBe(videos.length);

			for (const video of videos) {
				const drawCount = drawn.get(video.path)?.size ?? 0;

				expect(drawCount).toBeGreaterThan(0);
				expect(calls.get(video.path) ?? 0).toBe(drawCount);
			}
		} finally {
			wrapper?.unmount();
			restore();
		}
	});
});

/**
 * El marcado de la tarjeta, capturado del código sin el arreglo.
 *
 * El componente que resuelve la miniatura sólo la provee por slot: no agrega
 * ningún elemento. Si eso dejara de ser cierto —un envoltorio, un `div` de
 * más— la tarjeta cambiaría de forma y esto lo delata. Se comparan las dos
 * ramas, con miniatura y sin ella, porque cada una dibuja capas distintas.
 *
 * Se ignora `data-icon-id`, que es un contador global del tema de íconos y no
 * dice nada de la tarjeta.
 *
 * Las capturas se guardan con extensión `.txt` y no `.html` a propósito:
 * `biome check` mira los `.html` y le exige `type="button"` al botón, que la
 * vista no escribe.
 */
describe('el marcado de la tarjeta de video', () => {
	function normalize(html: string): string {
		return html.replace(/ data-icon-id="\d+"/g, '').trim();
	}

	async function cardHtml(withThumbnail: boolean): Promise<string> {
		const restore = withViewportHeight(900);
		let wrapper: VueWrapper | null = null;

		try {
			wrapper = mountGrid(withThumbnail);
			await nextTick();
			const button = wrapper.find(`[data-entry-path="${FIRST_CLIP}"]`);

			return normalize((button.element as Element).outerHTML);
		} finally {
			wrapper?.unmount();
			restore();
		}
	}

	async function golden(name: string): Promise<string> {
		const text = await Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();

		return normalize(text);
	}

	test('sin miniatura es el mismo que dibujaba el código viejo', async () => {
		expect(await cardHtml(false)).toBe(await golden('video-card-sin-miniatura.txt'));
	});

	test('con miniatura es el mismo que dibujaba el código viejo', async () => {
		expect(await cardHtml(true)).toBe(await golden('video-card-con-miniatura.txt'));
	});
});
