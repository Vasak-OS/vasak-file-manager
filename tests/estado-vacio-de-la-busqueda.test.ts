/**
 * Lo que dice la búsqueda global cuando no tiene nada que buscar.
 *
 * Decía «Datos de búsqueda incompletos · Sin unidades seleccionadas». Lo
 * segundo es de cuando se elegían unidades a mano: esa preferencia está
 * comentada en el store desde hace rato y hoy se recorren todas las del
 * sistema. O sea que el cartel nombraba una causa que ya no existe —y que
 * manda a buscar una pantalla de ajustes que no la tiene— y dejaba sin nombrar
 * la única que sí: **todavía no hay índice**.
 *
 * La condición que lo dibuja es exactamente ésa: el índice está vacío y nadie
 * lo está armando en este momento. La misma condición apaga el campo de
 * búsqueda de arriba, así que quien lo ve tampoco puede escribir, y el cartel
 * es lo único que puede explicárselo.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import GlobalSearchView from '@/views/GlobalSearchView.vue';
import { olvidarTodo, responder } from './dobles';

/** Deja que terminen las promesas del montaje. */
async function asentar(vueltas = 6) {
	for (let i = 0; i < vueltas; i++) {
		await Promise.resolve();
		await new Promise((sigue) => setTimeout(sigue, 0));
	}
}

/**
 * La vista con el índice en el estado que se le diga.
 *
 * El doble de `t()` devuelve la clave, así que lo que se lee en el texto es la
 * clave que eligió la plantilla.
 */
async function conElIndice(estado: Record<string, unknown>) {
	responder('get_index_status', estado);
	const vista = mount(GlobalSearchView);
	await asentar();
	return vista;
}

let vista: VueWrapper | null = null;

afterEach(() => {
	// `useReactiveIcon` lleva la cuenta de cuántos la usan en una variable del
	// módulo y se suscribe al cambio de tema sólo cuando esa cuenta pasa de cero
	// a uno. Una vista que queda montada nunca la baja, y la siguiente prueba
	// —acá o **en otro archivo**— se salta la suscripción. Así se rompió la del
	// cambio de tema de `plantillas-estrictas`, que pasa sola y fallaba con la
	// suite entera.
	vista?.unmount();
	vista = null;
});

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
});

describe('con el índice vacío', () => {
	test('dice que no hay nada indexado, y no habla de unidades sin elegir', async () => {
		vista = await conElIndice({ indexed_item_count: 0 });

		const texto = vista.text();
		expect(texto).toContain('globalSearch.indexEmpty');
		expect(texto).toContain('globalSearch.indexEmptyDescription');
		expect(texto).not.toContain('noDrivesSelected');
		expect(texto).not.toContain('searchDataIncomplete');
	});

	test('y el campo de búsqueda está apagado, que es lo que el cartel explica', async () => {
		// Si el campo dejara de apagarse, el cartel diría una cosa que no pasa.
		vista = await conElIndice({ indexed_item_count: 0 });

		expect(vista.get('input').attributes('disabled')).toBeDefined();
	});
});

describe('los catálogos', () => {
	test('ya no traen las dos claves viejas', async () => {
		// Quedaban sin usar en los dos idiomas, y una lista de claves muertas es
		// por donde vuelve el texto equivocado.
		for (const idioma of ['en', 'es']) {
			const catalogo = await Bun.file(
				new URL(`../src-tauri/locales/${idioma}.yml`, import.meta.url)
			).text();

			expect(catalogo).not.toContain('noDrivesSelected');
			expect(catalogo).not.toContain('searchDataIncomplete');
		}
	});

	test('y las nuevas dicen lo mismo en los dos idiomas', async () => {
		// No el mismo texto —son idiomas distintos— sino la misma idea: que lo
		// que falta es el índice. Se comprueba que ninguna de las dos hable de
		// unidades elegidas, que es de lo que venimos.
		const es = await Bun.file(new URL('../src-tauri/locales/es.yml', import.meta.url)).text();
		const en = await Bun.file(new URL('../src-tauri/locales/en.yml', import.meta.url)).text();

		expect(es).toContain('indexEmpty: Todavía no hay nada indexado');
		expect(en).toContain('indexEmpty: Nothing indexed yet');
		expect(es).toMatch(/indexEmptyDescription:[\s\S]{0,400}índice todavía está vacío/);
		expect(en).toMatch(/indexEmptyDescription:[\s\S]{0,400}index is still empty/);
	});
});
