import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	ordenVisual,
	type SeccionVisual,
	vecinoLineal,
	vecinoVertical,
} from '../src/composables/file-browser/recorrido-visual';
import type { DirEntry } from '../src/types/dir-entry';

/**
 * Moverse con las flechas sin mirar la pantalla.
 *
 * La navegación averiguaba qué entrada estaba «abajo» comparando
 * `getBoundingClientRect()` de **todos** los elementos dibujados. Eso funciona
 * mientras el directorio entero esté en el DOM y deja de funcionar apenas se
 * virtualice: con veinte filas dibujadas, la veintiuno no existe y la flecha no
 * encuentra a dónde ir.
 *
 * Acá el recorrido sale de los datos y de un número por sección —cuántas entran
 * por fila—, que es lo único que hay que saber de la pantalla.
 */
const entrada = (name: string): DirEntry => ({ name, path: `/dir/${name}` }) as DirEntry;

/** Una sección de `n` entradas nombradas con un prefijo. */
const seccion = (prefijo: string, n: number, columnas: number): SeccionVisual => ({
	entradas: Array.from({ length: n }, (_, i) => entrada(`${prefijo}${i}`)),
	columnas,
});

const nombre = (e: DirEntry | null) => e?.name ?? null;

describe('la vista de lista: una sección de una columna', () => {
	const lista = [seccion('a', 5, 1)];

	test('bajar es la siguiente y subir es la anterior', () => {
		expect(nombre(vecinoVertical(lista, '/dir/a2', 'abajo'))).toBe('a3');
		expect(nombre(vecinoVertical(lista, '/dir/a2', 'arriba'))).toBe('a1');
	});

	test('en los bordes no se da la vuelta', () => {
		// Llegar al final y aparecer en el principio desorienta, y era el
		// comportamiento de antes: no se envuelve.
		expect(vecinoVertical(lista, '/dir/a4', 'abajo')).toBeNull();
		expect(vecinoVertical(lista, '/dir/a0', 'arriba')).toBeNull();
	});

	test('sin nada seleccionado se arranca por un extremo', () => {
		expect(nombre(vecinoVertical(lista, null, 'abajo'))).toBe('a0');
		expect(nombre(vecinoVertical(lista, null, 'arriba'))).toBe('a4');
	});

	test('una entrada que ya no está lleva al extremo, no rompe', () => {
		// Pasa de verdad: se borra el archivo seleccionado y llega una flecha
		// antes de que la selección se acomode.
		expect(nombre(vecinoVertical(lista, '/dir/no-existe', 'abajo'))).toBe('a0');
		expect(nombre(vecinoLineal(lista, '/dir/no-existe', 'siguiente'))).toBe('a0');
	});
});

describe('la cuadrícula: varias secciones con distintas columnas', () => {
	// Como la vista de verdad: carpetas, imágenes, videos y el resto.
	const rejilla = [seccion('carpeta', 7, 3), seccion('imagen', 5, 4), seccion('otro', 2, 4)];

	test('bajar dentro de la sección salta una fila entera', () => {
		expect(nombre(vecinoVertical(rejilla, '/dir/carpeta1', 'abajo'))).toBe('carpeta4');
		expect(nombre(vecinoVertical(rejilla, '/dir/carpeta4', 'arriba'))).toBe('carpeta1');
	});

	test('bajar a una fila incompleta cae en la última de esa fila', () => {
		// carpeta7 no existe: la última fila tiene una sola (carpeta6).
		expect(nombre(vecinoVertical(rejilla, '/dir/carpeta4', 'abajo'))).toBe('carpeta6');
	});

	/**
	 * Es lo que hacía la versión que medía: buscaba la más cercana en
	 * horizontal. Bajar desde la tercera carpeta tiene que caer en la tercera
	 * imagen, no en la primera.
	 */
	test('pasar de una sección a otra conserva la columna', () => {
		expect(nombre(vecinoVertical(rejilla, '/dir/carpeta6', 'abajo'))).toBe('imagen0');
		// La última fila de carpetas tiene una sola (carpeta6, en la columna 0),
		// así que subir desde la columna 2 cae ahí: es la más cercana de esa
		// fila, igual que con la versión que medía.
		expect(nombre(vecinoVertical(rejilla, '/dir/imagen2', 'arriba'))).toBe('carpeta6');
	});

	test('subir desde la sección de abajo cae en la última fila de la de arriba', () => {
		// La sección de imágenes tiene 5 en filas de 4: la última fila es imagen4.
		expect(nombre(vecinoVertical(rejilla, '/dir/otro1', 'arriba'))).toBe('imagen4');
	});

	test('las flechas de los costados siguen el orden en que se ve, no el del arreglo', () => {
		// El orden visual es el agrupado: carpetas, después imágenes, después el
		// resto. La última carpeta y la primera imagen son vecinas.
		expect(nombre(vecinoLineal(rejilla, '/dir/carpeta6', 'siguiente'))).toBe('imagen0');
		expect(nombre(vecinoLineal(rejilla, '/dir/imagen0', 'anterior'))).toBe('carpeta6');
	});

	test('el orden visual son todas, una sola vez', () => {
		const todas = ordenVisual(rejilla);

		expect(todas.length).toBe(7 + 5 + 2);
		expect(new Set(todas.map((e) => e.path)).size).toBe(todas.length);
		expect(todas[0].name).toBe('carpeta0');
		expect(todas[todas.length - 1].name).toBe('otro1');
	});
});

describe('los casos que rompen', () => {
	test('sin entradas no hay a dónde ir', () => {
		expect(vecinoVertical([], null, 'abajo')).toBeNull();
		expect(vecinoLineal([], null, 'siguiente')).toBeNull();
	});

	test('las secciones vacías no cuentan como fila', () => {
		// La cuadrícula sólo dibuja la sección que tiene algo, así que bajar
		// desde la última carpeta tiene que llegar al «resto», salteándose las
		// imágenes que no están.
		const conVacias = [seccion('carpeta', 2, 2), seccion('imagen', 0, 4), seccion('otro', 3, 3)];

		expect(nombre(vecinoVertical(conVacias, '/dir/carpeta1', 'abajo'))).toBe('otro1');
	});

	test('viniendo de una sección más ancha, se cae en la primera fila de la angosta', () => {
		// Cuatro columnas arriba, dos abajo: la columna 3 no existe en la de
		// abajo. Sin recortarla, el índice 3 es la **segunda** fila de la
		// vecina, y bajar una fila saltaría dos.
		const anchaYAngosta = [seccion('carpeta', 4, 4), seccion('imagen', 6, 2)];

		expect(nombre(vecinoVertical(anchaYAngosta, '/dir/carpeta3', 'abajo'))).toBe('imagen1');
		expect(nombre(vecinoVertical(anchaYAngosta, '/dir/carpeta2', 'abajo'))).toBe('imagen1');
		expect(nombre(vecinoVertical(anchaYAngosta, '/dir/carpeta0', 'abajo'))).toBe('imagen0');
	});

	test('subiendo a una sección más angosta también se recorta la columna', () => {
		// Dos columnas arriba, cuatro abajo: subiendo desde la columna 3 hay que
		// caer en la última fila de la de arriba, no más allá.
		const angostaYAncha = [seccion('carpeta', 5, 2), seccion('imagen', 4, 4)];

		expect(nombre(vecinoVertical(angostaYAncha, '/dir/imagen3', 'arriba'))).toBe('carpeta4');
	});

	test('cero columnas no divide por cero', () => {
		// Puede llegar así de una medición que ocurrió con el panel oculto.
		const rota: SeccionVisual[] = [{ entradas: [entrada('a'), entrada('b')], columnas: 0 }];

		expect(nombre(vecinoVertical(rota, '/dir/a', 'abajo'))).toBe('b');
	});
});

describe('la navegación ya no mide la pantalla', () => {
	const NAVEGACION = readFileSync(
		join(
			import.meta.dir,
			'..',
			'src',
			'composables',
			'file-browser',
			'use-file-browser-keyboard-navigation.ts'
		),
		'utf8'
	);
	const codigo = NAVEGACION.split('*/').slice(1).join('*/');

	test('no mide rectángulos ni pide todos los elementos', () => {
		// Es lo que deja de funcionar al virtualizar: con veinte filas en el DOM,
		// medirlas no dice nada de la veintiuno.
		for (const medicion of ['getBoundingClientRect', 'querySelectorAll', 'offsetTop']) {
			expect(codigo).not.toContain(medicion);
		}
	});

	test('sigue usando el DOM para enfocar y desplazar, que es otra cosa', () => {
		// Ahí el elemento existe: se acaba de seleccionar, así que está dibujado.
		expect(codigo).toContain('scrollIntoView');
		expect(codigo).toContain('.focus(');
	});

	test('las cuatro flechas salen del recorrido sobre los datos', () => {
		expect(codigo).toContain("vecinoVertical(seccionesVisibles(), rutaActual(), 'arriba')");
		expect(codigo).toContain("vecinoVertical(seccionesVisibles(), rutaActual(), 'abajo')");
		expect(codigo).toContain("vecinoLineal(seccionesVisibles(), rutaActual(), 'anterior')");
		expect(codigo).toContain("vecinoLineal(seccionesVisibles(), rutaActual(), 'siguiente')");
	});

	test('sin secciones informadas se asume la lista', () => {
		// La vista de lista es una sección de una columna; que sea el valor por
		// omisión es lo que hace que el modo de búsqueda siga andando sin tocar
		// nada.
		expect(codigo).toContain('return [{ entradas: options.entries.value, columnas: 1 }];');
	});
});

describe('las dos vistas informan cómo se ven', () => {
	const RAIZ = join(import.meta.dir, '..');
	const LISTA = readFileSync(
		join(RAIZ, 'src', 'views', 'filebrowser', 'FileBrowserListView.vue'),
		'utf8'
	);
	const REJILLA = readFileSync(
		join(RAIZ, 'src', 'views', 'filebrowser', 'FileBrowserGridView.vue'),
		'utf8'
	);

	test('la lista informa una sección de una columna', () => {
		// Aunque sea lo que se asume: al volver de la cuadrícula hay que
		// reemplazar las cuatro secciones que dejó, o las flechas se mueven como
		// si hubiera columnas.
		expect(LISTA).toContain('columnas: 1');
		expect(LISTA).toContain('ctx.registrarSeccionesVisuales(');
	});

	test('la cuadrícula cuenta las columnas una sola vez y con eso dibuja', () => {
		// El mismo número que decide dónde se corta cada fila es el que se le
		// escribe a la fila. Si una de las dos cosas saliera de otro lado —del
		// `auto-fill` del CSS, por ejemplo— podrían discrepar, y una fila con
		// más tarjetas de las que entran se parte en dos y se pisa con la
		// siguiente.
		expect(REJILLA).toContain('columnasQueEntran(anchos.value[clave]');
		// En dos mitades para no escribir un `${` dentro de una cadena, que el
		// linter toma por una plantilla mal escrita.
		expect(REJILLA).toContain('gridTemplateColumns: `repeat(');
		expect(REJILLA).toContain(', minmax(0, 1fr))`');
		expect(REJILLA).toContain('ResizeObserver');
	});

	test('la cuadrícula informa las cuatro secciones, en el orden en que se ven', () => {
		expect(REJILLA).toContain("const CLAVES: Clave[] = ['dirs', 'images', 'videos', 'others'];");
		expect(REJILLA).toContain('ctx.registrarSeccionesVisuales(');
		expect(REJILLA).toContain('entradas: groupedEntries.value[clave]');
	});
});
