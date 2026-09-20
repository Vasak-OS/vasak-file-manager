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
 * romper solo. De la misma familia es el tercero: el globo marcaba su
 * contenido con un atributo `popover-content` a secas, que `strictTemplates`
 * rechaza por no ser ni una propiedad ni un `data-*`. Renombrarlo obliga a
 * mover también el `closest()` que lo busca, y si los dos no se mueven juntos
 * el globo se cierra al tocarlo.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';
import FileBrowserErrorComponent from '@/components/filebrowser/FileBrowserErrorComponent.vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import ResizablePanel from '@/components/ui/ResizablePanel.vue';
import { emitir, olvidarTodo, ponerEnElTema } from './dobles';

beforeEach(() => {
	olvidarTodo();
});

/** Deja que terminen las promesas encadenadas del pedido del icono. */
async function asentar(vueltas = 8) {
	for (let i = 0; i < vueltas; i++) {
		await nextTick();
		await new Promise((sigue) => setTimeout(sigue, 0));
	}
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
			await asentar();

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

describe('el globo y la marca de su contenido', () => {
	/**
	 * Un globo abierto, con su contenido ya teletransportado al `body`.
	 *
	 * Se devuelve el `Popover` de afuera porque es el que avisa de que se
	 * cierra: `update:open` sale de ahí.
	 */
	function abrirUnGlobo() {
		return mount(Popover, {
			props: { open: true },
			slots: { default: () => h(PopoverContent, null, () => 'contenido') },
			attachTo: document.body,
		});
	}

	/** Un clic que sube hasta `document`, como el de cualquier otro nodo. */
	function clicDesde(nodo: HTMLElement) {
		nodo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	}

	test('un clic dentro de otro globo no lo cierra', async () => {
		// Es para lo que está la marca. El contenido se teletransporta al
		// `body`, así que un segundo globo no es descendiente del primero: su
		// clic llega a `document` con un destino de afuera, y sin reconocer la
		// marca el primero se cerraría. Pasa de verdad con el menú de columnas
		// abierto sobre el filtro.
		const globo = abrirUnGlobo();
		const otro = document.createElement('div');
		otro.setAttribute('data-popover-content', '');
		document.body.appendChild(otro);

		try {
			clicDesde(otro);
			await nextTick();

			expect(globo.emitted('update:open')).toBeUndefined();
		} finally {
			otro.remove();
			globo.unmount();
		}
	});

	test('y un clic en cualquier otro lado sí lo cierra', async () => {
		const globo = abrirUnGlobo();
		const afuera = document.createElement('div');
		document.body.appendChild(afuera);

		try {
			clicDesde(afuera);
			await nextTick();

			expect(globo.emitted('update:open')).toEqual([[false]]);
		} finally {
			afuera.remove();
			globo.unmount();
		}
	});

	test('la marca que se dibuja es la misma que se busca', async () => {
		// Las dos puntas viven en el mismo archivo y se tienen que mover
		// juntas; si el atributo se renombrara sin tocar el `closest()`, las
		// dos pruebas de arriba lo dirían, pero esta nombra el porqué.
		const globo = abrirUnGlobo();

		try {
			expect(document.querySelector('[data-popover-content]')).not.toBeNull();
		} finally {
			globo.unmount();
		}
	});
});
