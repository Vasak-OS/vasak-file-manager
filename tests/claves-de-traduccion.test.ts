/**
 * Que lo que se dibuja sea la traducción y no la clave.
 *
 * La aplicación mostraba `globalSearch.globalSearch` de marcador del campo de
 * búsqueda, `fileBrowser.itemCount 3` debajo de cada carpeta, `drag.copyItems
 * 5` en el cartel que sigue al puntero y `conflictDialog.description 2` en el
 * diálogo de conflictos. Ninguna pasaba por `t()`: eran la clave armada a mano
 * adentro de una cadena.
 *
 * Y varias de las claves que nombraban **no existían** en los `.yml`, así que
 * envolverlas en `t()` sin mirar habría cambiado una clave visible por otra.
 *
 * De ahí los cuatro guardias de acá: ninguna clave escrita a mano, ninguna
 * clave suelta entre comillas en una plantilla, ninguna clave que no exista, y
 * los dos idiomas con las mismas.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mount } from '@vue/test-utils';
import DragOverlayComponent from '@/components/drag/DragOverlayComponent.vue';

// El cartel de arrastre se teletransporta al `body`, así que lo montado se
// limpia a mano: si no, lo de una prueba lo ve la siguiente.
afterEach(() => {
	document.body.innerHTML = '';
});

const RAIZ = new URL('../src', import.meta.url).pathname;
const es = await Bun.file(new URL('../src-tauri/locales/es.yml', import.meta.url)).text();
const en = await Bun.file(new URL('../src-tauri/locales/en.yml', import.meta.url)).text();

/** Los archivos de la aplicación, con su contenido. */
const fuentes = await Promise.all(
	[...new Bun.Glob('**/*.{vue,ts}').scanSync({ cwd: RAIZ })].map(async (archivo) => ({
		archivo,
		contenido: await Bun.file(new URL(`../src/${archivo}`, import.meta.url)).text(),
	}))
);

/**
 * Las rutas con punto que define un archivo de traducciones.
 *
 * Lector de sangría, no un YAML completo: estos archivos son dos o tres niveles
 * de `clave: valor` y nada más —ni listas, ni anclas, ni bloques de varias
 * líneas—, así que alcanza con mirar la sangría. Si algún día dejan de serlo,
 * esta prueba se rompe en vez de mentir.
 */
function rutasDe(yaml: string): Set<string> {
	const rutas = new Set<string>();
	const pila: string[] = [];
	for (const linea of yaml.split('\n')) {
		const coincidencia = linea.match(/^(\s*)([A-Za-z0-9_]+):(.*)$/);
		if (!coincidencia) continue;
		const [, sangria, clave, resto] = coincidencia;
		const nivel = sangria.length / 2;
		pila.length = nivel;
		pila.push(clave);
		// Con valor es una hoja; sin él, un grupo que no se nombra solo.
		if (resto.trim() !== '') rutas.add(pila.join('.'));
	}
	return rutas;
}

const rutasEs = rutasDe(es);
const rutasEn = rutasDe(en);

/** Las claves que el fuente nombra, con el archivo donde aparecen. */
function clavesUsadas(): Map<string, string[]> {
	const usos = new Map<string, string[]>();
	const anotar = (clave: string, archivo: string) => {
		const donde = usos.get(clave) ?? [];
		donde.push(archivo);
		usos.set(clave, donde);
	};

	for (const { archivo, contenido } of fuentes) {
		// `(?<![\w$.])` para no confundirse con el final de otra palabra:
		// `clearTimeout(...)` termina en `t(` y contaba como una traducción.
		for (const [, clave] of contenido.matchAll(/(?<![\w$.])t\('([^']+)'\)/g)) {
			anotar(clave, archivo);
		}
		// La forma de las cantidades: una base que se convierte en dos claves.
		for (const [, base] of contenido.matchAll(/claveSegunCantidad\('([^']+)'/g)) {
			anotar(`${base}One`, archivo);
			anotar(`${base}Other`, archivo);
		}
	}
	return usos;
}

describe('las claves', () => {
	test('hay archivos y traducciones que revisar', () => {
		// Todo lo de abajo afirma ausencias: si el glob o el lector fallan en
		// silencio, las cuatro pruebas pasan sin haber mirado nada.
		expect(fuentes.length).toBeGreaterThan(50);
		expect(rutasEs.size).toBeGreaterThan(100);
		expect(clavesUsadas().size).toBeGreaterThan(100);
	});

	test('no se arman a mano adentro de una cadena', () => {
		// `` `fileBrowser.itemCount ${n}` `` no es una traducción: es la clave
		// impresa tal cual. Este guardia tuvo una lista de siete archivos
		// exceptuados; está vacía.
		const raices = [...es.matchAll(/^(\w+):$/gm)].map((coincidencia) => coincidencia[1]);
		expect(raices.length).toBeGreaterThan(5);

		const culpables: string[] = [];
		for (const { archivo, contenido } of fuentes) {
			for (const raiz of raices) {
				if (contenido.includes(`\`${raiz}.`)) culpables.push(`${archivo} → \`${raiz}.…\``);
			}
		}

		expect(culpables).toEqual([]);
	});

	test('no se dibujan sueltas entre comillas', () => {
		// El marcador del campo de búsqueda era `:placeholder="'globalSearch.
		// globalSearch'"`, el estado del recorrido tres claves en un ternario y
		// la ayuda de «pestaña nueva» la clave **con las comillas puestas**:
		// sin `t()` alrededor, lo que se ve es la clave.
		//
		// Se mira expresión por expresión y no clave por clave: `t(a ? 'x' :
		// 'y')` es correcto y mirando sólo lo que viene justo antes de la
		// comilla parecía una clave suelta.
		const culpables: string[] = [];
		for (const { archivo, contenido } of fuentes) {
			const inicio = contenido.indexOf('<template>');
			if (inicio === -1) continue;
			const plantilla = contenido.slice(inicio);

			const expresiones = [
				// Lo que se dibuja: `{{ … }}`.
				...[...plantilla.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((una) => una[1]),
				// Y lo que se ata a un atributo: `:algo="…"`, `v-if="…"`.
				...[...plantilla.matchAll(/(?::|v-)[\w.-]+="([^"]*)"/g)].map((una) => una[1]),
			];

			for (const expresion of expresiones) {
				// Una expresión que llama a `t()` ya pasa por las traducciones.
				if (expresion.includes('t(')) continue;
				for (const [, clave] of expresion.matchAll(/'([A-Za-z0-9_]+\.[A-Za-z0-9_.]+)'/g)) {
					// Sólo si es una clave de verdad: hay cadenas con punto que
					// no lo son —una ruta, una extensión, un selector—.
					if (rutasEs.has(clave)) culpables.push(`${archivo} → '${clave}'`);
				}
			}

			// El caso de la ayuda: la clave escrita como texto plano, con
			// comillas y todo, fuera de cualquier expresión.
			for (const [, clave] of plantilla.matchAll(/^\s*'([A-Za-z0-9_]+\.[A-Za-z0-9_.]+)'\s*$/gm)) {
				if (rutasEs.has(clave)) culpables.push(`${archivo} → texto plano '${clave}'`);
			}
		}

		expect(culpables).toEqual([]);
	});

	test('todas las que el fuente nombra existen en los dos idiomas', () => {
		// Media pantalla de búsqueda global nombraba claves inventadas
		// —`searchStats.foundOnDrives`, `indexStatus.committing`—, así que
		// envolverlas en `t()` habría cambiado una clave visible por otra.
		const faltan: string[] = [];
		for (const [clave, archivos] of clavesUsadas()) {
			const donde = archivos[0];
			if (!rutasEs.has(clave)) faltan.push(`es.yml: ${clave} (${donde})`);
			if (!rutasEn.has(clave)) faltan.push(`en.yml: ${clave} (${donde})`);
		}

		expect(faltan).toEqual([]);
	});

	test('los dos idiomas tienen las mismas', () => {
		// Una clave en uno solo es una pantalla que se ve bien en un idioma y
		// muestra la clave en el otro.
		const soloEnEs = [...rutasEs].filter((ruta) => !rutasEn.has(ruta));
		const soloEnEn = [...rutasEn].filter((ruta) => !rutasEs.has(ruta));

		expect({ soloEnEs, soloEnEn }).toEqual({ soloEnEs: [], soloEnEn: [] });
	});
});

describe('las cantidades', () => {
	/**
	 * El valor en español de una clave.
	 *
	 * Las pruebas de abajo miran el texto de verdad y no sólo la clave: una
	 * clave bien elegida que apunte a «Copiar {0} elementos» para un solo
	 * archivo sigue estando mal.
	 */
	function enEspanol(ruta: string): string {
		const pila: string[] = [];
		for (const linea of es.split('\n')) {
			const coincidencia = linea.match(/^(\s*)([A-Za-z0-9_]+):(.*)$/);
			if (!coincidencia) continue;
			const [, sangria, clave, resto] = coincidencia;
			pila.length = sangria.length / 2;
			pila.push(clave);
			if (pila.join('.') === ruta) {
				return resto.trim().replace(/^"(.*)"$/, '$1');
			}
		}
		throw new Error(`no existe la clave ${ruta}`);
	}

	test('uno no dice «elementos»', () => {
		// El motivo de que haya par: sin él, arrastrar un archivo decía
		// «Copiar 1 elementos» y una carpeta con uno solo, «1 elementos».
		expect(enEspanol('drag.copyItemsOne')).toBe('Copiar {0} elemento');
		expect(enEspanol('drag.copyItemsOther')).toBe('Copiar {0} elementos');
		expect(enEspanol('fileBrowser.itemCountOne')).toBe('{0} elemento');
		expect(enEspanol('fileBrowser.itemCountOther')).toBe('{0} elementos');
	});

	test('todas las que se eligen por cantidad tienen su par y su marcador', () => {
		// Un par al que le falte el `{0}` deja la cantidad afuera: «Copiar
		// elementos», sin decir cuántos.
		const bases = new Set<string>();
		for (const { contenido } of fuentes) {
			for (const [, base] of contenido.matchAll(/claveSegunCantidad\('([^']+)'/g)) {
				bases.add(base);
			}
		}
		expect(bases.size).toBeGreaterThan(5);

		const sinMarcador: string[] = [];
		for (const base of bases) {
			for (const sufijo of ['One', 'Other']) {
				if (!enEspanol(`${base}${sufijo}`).includes('{0}')) {
					sinMarcador.push(`${base}${sufijo}`);
				}
			}
		}

		expect(sinMarcador).toEqual([]);
	});
});

describe('el cartel que sigue al puntero', () => {
	// Decía `drag.copyItems 5` mientras se arrastraban cinco archivos. Se monta
	// para comprobar que elige la clave correcta: el `t()` de los dobles
	// devuelve la clave, así que lo que se dibuja **es** la que se eligió.
	function arrastrando(itemCount: number, operationType: 'copy' | 'move') {
		return mount(DragOverlayComponent, {
			props: {
				isActive: true,
				itemCount,
				operationType,
				cursorX: 10,
				cursorY: 10,
				dragItems: [],
			},
			attachTo: document.body,
		});
	}

	test('un archivo se arrastra en singular', () => {
		arrastrando(1, 'copy');
		expect(document.body.textContent).toContain('drag.copyItemsOne');
	});

	test('y varios en plural', () => {
		arrastrando(5, 'copy');
		expect(document.body.textContent).toContain('drag.copyItemsOther');
	});

	test('mover no dice copiar', () => {
		arrastrando(5, 'move');
		expect(document.body.textContent).toContain('drag.moveItemsOther');
	});
});
