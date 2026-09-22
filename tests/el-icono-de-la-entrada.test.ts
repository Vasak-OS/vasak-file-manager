/**
 * El icono de cada fila del listado.
 *
 * Es el único icono del gestor cuyo **nombre** depende del tema: sale de
 * recorrer la cadena que arma GIO para el tipo de contenido y quedarse con el
 * primero que el tema tenga. `ThemeIcon` sabe volver a pedir la imagen de un
 * nombre cuando cambia el tema, pero no que el nombre mismo puede dejar de
 * corresponder — y eso no falla ni avisa: un tema con más iconos seguiría
 * dibujando los genéricos del anterior hasta que alguien cambie de carpeta.
 *
 * Eso es lo que sabía la copia propia del composable y es lo que se prueba acá.
 * Lo que la copia **no** sabía —memorizar por nombre entre componentes y
 * compartir el pedido en vuelo— lo prueba la librería, montado.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { olvidarLosIconosDelTema } from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import type { DirEntry } from '@/types/dir-entry';
import { olvidarNombres, olvidarQueSeOlvido } from '@/utils/iconos-de-entrada';
import { emitir, olvidarTodo, pedidos, ponerEnElTema, responder, variantesPedidas } from './dobles';

function entrada(sobre: Partial<DirEntry> = {}): DirEntry {
	return {
		name: 'algo.py',
		path: '/home/pato/algo.py',
		is_dir: false,
		is_symlink: false,
		size: 0,
		mime: 'text/x-python',
		ext: 'py',
		modified: 0,
		item_count: null,
		...sobre,
	} as DirEntry;
}

/** Deja que terminen las promesas encadenadas del pedido del icono. */
async function asentar(vueltas = 8) {
	for (let i = 0; i < vueltas; i++) {
		await nextTick();
		await new Promise((sigue) => setTimeout(sigue, 0));
	}
}

/**
 * Lo mismo, esperando además a que el planificador recargue.
 *
 * Desde la 1.3.0 el cambio de tema no vuelve a pedir en el acto: vacía la
 * memoria y **agenda** la recarga, para que el anuncio del tema de iconos y el
 * de GTK no disparen dos barridos.
 */
async function asentarConLaRecarga() {
	await new Promise((sigue) => setTimeout(sigue, 150));
	await asentar();
}

let montadas: VueWrapper[] = [];

function montar(entry: DirEntry) {
	const icono = mount(EntryIconComponent, { props: { entry } });
	montadas.push(icono);
	return icono;
}

beforeEach(() => {
	olvidarTodo();
	olvidarNombres();
	olvidarQueSeOlvido();
	// La memoria de la librería vive en su módulo y sobrevive entre archivos de
	// prueba: sin vaciarla, esto ve el icono que dejó otra.
	olvidarLosIconosDelTema();
});

afterEach(() => {
	// Una vista que queda montada deja su icono anotado en el planificador y
	// suscrita al tema; la siguiente prueba arranca con basura de ésta.
	for (const una of montadas) una.unmount();
	montadas = [];
	olvidarLosIconosDelTema();
});

describe('el nombre del icono sale del tipo, no de la extensión', () => {
	test('dibuja el primero de la cadena que el tema tenga', async () => {
		responder('iconos_de_tipo', () => ['text-x-python', 'text-x-script', 'text-x-generic']);
		// El tema de este caso no tiene el preciso.
		responder('plugin:vicons|has_icon', ({ name }) => name === 'text-x-generic');
		ponerEnElTema('text-x-generic', 'data:image/svg+xml,generico');

		const icono = montar(entrada());
		await asentar();

		expect(icono.get('img').attributes('src')).toBe('data:image/svg+xml,generico');
	});

	test('y al cambiar el tema vuelve a elegir, no sólo a redibujar', async () => {
		// Es la diferencia entera. `ThemeIcon` solo vuelve a pedir la imagen de
		// `text-x-generic` y la deja igual de genérica: quien tiene que cambiar
		// es el **nombre**, porque el tema nuevo sí trae el preciso.
		responder('iconos_de_tipo', () => ['text-x-python', 'text-x-generic']);
		responder('plugin:vicons|has_icon', ({ name }) => name === 'text-x-generic');
		ponerEnElTema('text-x-generic', 'data:image/svg+xml,generico');
		ponerEnElTema('text-x-python', 'data:image/svg+xml,python');

		const icono = montar(entrada());
		await asentar();
		expect(icono.get('img').attributes('src')).toBe('data:image/svg+xml,generico');

		responder('plugin:vicons|has_icon', () => true);
		await emitir('vicons:theme-changed', null);
		await asentarConLaRecarga();

		expect(icono.get('img').attributes('src')).toBe('data:image/svg+xml,python');
	});

	test('una carpeta no le pregunta nada a nadie', async () => {
		responder('plugin:vicons|has_icon', () => true);
		ponerEnElTema('folder', 'data:image/svg+xml,carpeta');

		const icono = montar(entrada({ is_dir: true, mime: 'inode/directory' }));
		await asentar();

		expect(icono.get('img').attributes('src')).toBe('data:image/svg+xml,carpeta');
		expect(pedidos('iconos_de_tipo')).toHaveLength(0);
	});
});

describe('sesenta filas no son sesenta viajes', () => {
	test('la cadena del tipo se pide una vez, no una por fila', async () => {
		responder('iconos_de_tipo', () => ['text-x-ruby']);
		responder('plugin:vicons|has_icon', () => true);
		ponerEnElTema('text-x-ruby', 'data:image/svg+xml,ruby');

		for (let i = 0; i < 60; i++) {
			montar(entrada({ path: `/home/pato/${i}.rb`, mime: 'text/x-ruby' }));
		}
		await asentar();

		expect(pedidos('iconos_de_tipo')).toHaveLength(1);
	});

	test('y al cambiar el tema se vuelve a elegir una vez, no sesenta', async () => {
		// Las sesenta se enteran del cambio en el mismo tic. Sin la versión de
		// por medio, cada una vaciaría lo que acababa de guardar la anterior y
		// serían sesenta recorridas de la cadena para contestar lo mismo que
		// una. Lo que se cuenta es `has_icon`, que es lo que cuesta elegir: la
		// cadena en sí no depende del tema y queda guardada aparte.
		responder('iconos_de_tipo', () => ['text-x-perl']);
		responder('plugin:vicons|has_icon', () => true);
		ponerEnElTema('text-x-perl', 'data:image/svg+xml,perl');

		for (let i = 0; i < 60; i++) {
			montar(entrada({ path: `/home/pato/${i}.pl`, mime: 'text/x-perl' }));
		}
		await asentar();
		const antes = pedidos('plugin:vicons|has_icon').length;

		await emitir('vicons:theme-changed', null);
		await asentarConLaRecarga();

		expect(pedidos('plugin:vicons|has_icon').length - antes).toBe(1);
	});

	test('y la imagen del nombre se pide una vez para las sesenta', async () => {
		// Esto lo gana la librería, que la copia de acá no hacía: memoriza por
		// nombre y comparte el pedido en vuelo.
		responder('iconos_de_tipo', () => ['text-x-lua']);
		responder('plugin:vicons|has_icon', () => true);
		ponerEnElTema('text-x-lua', 'data:image/svg+xml,lua');

		for (let i = 0; i < 60; i++) {
			montar(entrada({ path: `/home/pato/${i}.lua`, mime: 'text/x-lua' }));
		}
		await asentar();

		expect(variantesPedidas('text-x-lua')).toEqual(['icon']);
	});
});
