/**
 * Lo que `strictTemplates` destapó, y lo que hubo que atar para que siguiera
 * funcionando.
 *
 * Encender el chequeo estricto en `vue-tsc` no cambia nada por sí solo: lo que
 * cambia es que deja de mirar para otro lado. Salieron cuarenta y siete
 * errores en este repo, casi todos atributos que no hacían nada —`:size` sobre
 * un `<img>`, `variant` sobre un `<button>`— y que se van sin dejar rastro.
 *
 * Los dos de acá no son de esos:
 *
 * - la pantalla de error pedía un componente que no se importa en ningún lado,
 *   así que **no dibujaba icono**;
 * - el `@mousedown` del panel funcionaba por caída de atributos, y declararlo
 *   —que es lo que `strictTemplates` pide— lo saca de los atributos: sin
 *   reenviarlo a mano, hacer clic en un panel deja de enfocarlo y el chequeo
 *   sigue en verde.
 *
 * El segundo es el que importa: es la forma en que este arreglo se puede
 * romper solo. (Había un tercero, la marca del contenido del globo propio; el
 * globo ahora es el `Popover` de la librería, que lo prueba allá.)
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { forgetThemeIcons } from '@vasakgroup/vue-libvasak';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import FileBrowserErrorComponent from '@/components/filebrowser/FileBrowserErrorComponent.vue';
import ResizablePanel from '@/components/ui/ResizablePanel.vue';
import { emitir, olvidarTodo, ponerEnElTema } from './dobles';

beforeEach(() => {
	olvidarTodo();
	// La librería memoriza lo resuelto por nombre y tipo, y esa memoria vive en
	// el módulo: sin vaciarla, esta prueba ve el icono que dejó otra y
	// `ponerEnElTema` no cambia nada. Es para esto que la librería lo exporta.
	//
	// No va en `dobles.ts`: ese archivo lo importa `preparar.ts` para registrar
	// los mocks, así que importar la librería ahí la carga **antes** que ellos y
	// se rompen nueve pruebas de otros archivos.
	forgetThemeIcons();
});

/** Deja que terminen las promesas encadenadas del pedido del icono. */
async function asentar(vueltas = 8) {
	for (let i = 0; i < vueltas; i++) {
		await nextTick();
		await new Promise((sigue) => setTimeout(sigue, 0));
	}
}

/**
 * Lo mismo, pero esperando además a que el planificador recargue.
 *
 * Desde la 1.3.0 de la librería el cambio de tema no vuelve a pedir los iconos
 * en el acto: vacía la memoria y **agenda** la recarga, para que una ráfaga de
 * anuncios —el tema de iconos y el de GTK llegan juntos— no dispare dos
 * barridos. Esperar sólo microtareas, como hacía esto, deja la prueba mirando
 * el icono viejo aunque el mecanismo funcione.
 */
async function asentarConLaRecarga() {
	await new Promise((sigue) => setTimeout(sigue, 150));
	await asentar();
}

describe('la pantalla de error', () => {
	/**
	 * La pantalla montada, y desmontada pase lo que pase.
	 *
	 * `useReactiveIcon` lleva la cuenta de cuántos la usan en una variable del
	 * módulo, y se suscribe al cambio de tema sólo cuando esa cuenta pasa de
	 * cero a uno. Una pantalla que queda montada nunca la baja, así que la
	 * siguiente prueba se salta la suscripción y un cambio de tema no le
	 * cambia el icono. Lo marcó la revisión.
	 */
	async function conLaPantalla(mirar: (pantalla: ReturnType<typeof montarError>) => Promise<void>) {
		const pantalla = montarError();
		try {
			await mirar(pantalla);
		} finally {
			pantalla.unmount();
		}
	}

	function montarError() {
		return mount(FileBrowserErrorComponent, {
			props: { error: 'No se pudo leer la carpeta' },
		});
	}

	test('dibuja el icono del tema', async () => {
		ponerEnElTema('dialog-error', 'data:image/svg+xml,error');

		await conLaPantalla(async (pantalla) => {
			await asentar();

			expect(pantalla.get('img').attributes('src')).toBe('data:image/svg+xml,error');
		});
	});

	test('y sigue mostrando el mensaje y el botón', async () => {
		await conLaPantalla(async (pantalla) => {
			expect(pantalla.text()).toContain('No se pudo leer la carpeta');
			await pantalla.get('button').trigger('click');
			expect(pantalla.emitted('goHome')).toHaveLength(1);
		});
	});

	test('sin icono en el tema, no deja un roto colgado', async () => {
		// El doble del tema devuelve cadena vacía para lo que no tiene, igual
		// que el plugin de verdad. Un `<img src="">` dibuja el icono de imagen
		// rota del navegador, que es peor que no dibujar nada.
		await conLaPantalla(async (pantalla) => {
			await asentar();

			expect(pantalla.find('img').exists()).toBe(false);
		});
	});

	test('y el tema que cambia después le cambia el icono', async () => {
		// Es lo que se pierde si una prueba deja su pantalla montada: la cuenta
		// de `useReactiveIcon` no vuelve a cero, la suscripción no se rehace y
		// esto pasa a mirar un icono que ya no se actualiza.
		ponerEnElTema('dialog-error', 'data:image/svg+xml,viejo');

		await conLaPantalla(async (pantalla) => {
			await asentar();
			expect(pantalla.get('img').attributes('src')).toBe('data:image/svg+xml,viejo');

			ponerEnElTema('dialog-error', 'data:image/svg+xml,nuevo');
			await emitir('vicons:theme-changed', null);
			await asentarConLaRecarga();

			expect(pantalla.get('img').attributes('src')).toBe('data:image/svg+xml,nuevo');
		});
	});
});

describe('el panel que se puede redimensionar', () => {
	test('avisa del botón apretado a quien lo escucha', async () => {
		// Es cómo la barra del navegador sabe qué panel pasa a ser el activo en
		// vista dividida. Antes el evento no estaba declarado y llegaba por
		// caída de atributos; declararlo lo saca de los atributos, así que el
		// reenvío de adentro no es opcional. Sin él esto queda vacío, y nada
		// más se entera.
		const panel = mount(ResizablePanel);

		await panel.get('div').trigger('mousedown');

		expect(panel.emitted('mousedown')).toHaveLength(1);
	});

	test('y manda el evento entero, no un aviso pelado', async () => {
		// Quien escucha puede querer el botón o la tecla que acompañaba.
		const panel = mount(ResizablePanel);

		await panel.get('div').trigger('mousedown', { button: 2 });

		const [[evento]] = panel.emitted('mousedown') as [MouseEvent][];
		expect(evento).toBeInstanceOf(MouseEvent);
		expect(evento.button).toBe(2);
	});
});
