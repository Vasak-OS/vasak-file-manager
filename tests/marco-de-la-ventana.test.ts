/**
 * La ventana del gestor de archivos, ya con el marco compartido.
 *
 * El borde, la esquina, el fondo y la barra estaban escritos a mano acá. Lo que
 * se comprueba es dónde queda cada cosa al mudarlos, que es lo que se rompe sin
 * avisar: una ranura mal conectada no da ningún error, lo que se le ponga
 * desaparece en silencio.
 *
 * Las pestañas **no** se mudan en este cambio: el gestor trabaja con grupos —la
 * vista dividida es un grupo de dos— y eso necesita su propia traducción a la
 * barra compartida.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AppBar, WindowControls, WindowFrame } from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import NavigatorToolbarActionsComponent from '@/components/navigator/NavigatorToolbarActionsComponent.vue';
import TabBarComponent from '@/components/tab/TabBarComponent.vue';
import WindowAppLayout from '@/layouts/WindowAppLayout.vue';

let vista: VueWrapper | null = null;
/** Lo que cada llamada a `ranura()` dejó montado, para desmontarlo después. */
const sueltos: VueWrapper[] = [];

function abrir() {
	vista = mount(WindowAppLayout, {
		global: {
			stubs: {
				SidebarComponent: true,
				NavigatorBarComponent: true,
				ContentInformation: true,
			},
		},
	});
	return vista;
}

/**
 * Lo que se dibuja dentro de una ranura de la barra.
 *
 * Lo que monta **no** cuelga de `vista`, así que no se va con ella: se anota y
 * el `afterEach` lo desmonta.
 */
function ranura(ventana: VueWrapper, nombre: string) {
	const barra = ventana.findComponent(AppBar);
	const dibujar = (barra.vm.$slots as Record<string, (() => unknown) | undefined>)[nombre];
	if (!dibujar) return null;
	const suelto = mount({ render: () => dibujar() });
	sueltos.push(suelto);
	return suelto;
}

beforeEach(() => {
	setActivePinia(createPinia());
});

afterEach(() => {
	for (const suelto of sueltos.splice(0)) suelto.unmount();
	vista?.unmount();
	vista = null;
});

describe('la ventana', () => {
	test('usa el marco compartido', () => {
		expect(abrir().findComponent(WindowFrame).exists()).toBe(true);
	});

	test('y no queda un segundo borde dibujado a mano', () => {
		// `rounded-corner-window` es la esquina de la ventana y sale del marco.
		// Con dos, el borde y el fondo se dibujan dos veces y se ven los dos.
		expect(abrir().findAll('.rounded-corner-window').length).toBe(1);
	});

	test('con los tres botones y su nombre traducido', () => {
		// Sin las etiquetas salen en inglés, que son los valores por omisión de
		// la librería. Es el nombre accesible: lo único que lo dice es el lector
		// de pantalla.
		expect(
			abrir()
				.findComponent(WindowControls)
				.findAll('button')
				.map((boton) => boton.attributes('aria-label'))
		).toEqual(['window.minimize', 'window.maximize', 'window.close']);
	});
});

describe('lo que va en la barra', () => {
	test('las pestañas van en el contenido de la barra, que es lo que crece', () => {
		// Con muchas abiertas la fila desborda y se desplaza; en cualquier otra
		// zona empujaría a los botones fuera de la ventana.
		const dentro = ranura(abrir(), 'default');

		expect(dentro?.findComponent(TabBarComponent).exists()).toBe(true);
	});

	test('y los botones de la ventana en `acciones`, pegados a los de la ventana', () => {
		// Dividir la vista y mostrar el panel de información valen para toda la
		// ventana, no para un panel: van donde el resto de las aplicaciones
		// pone los suyos.
		const dentro = ranura(abrir(), 'acciones');

		expect(dentro?.findComponent(NavigatorToolbarActionsComponent).exists()).toBe(true);
	});
});

describe('lo que la barra no se lleva puesto', () => {
	test('el destino de la barra de ruta sigue en la columna de contenido', () => {
		// La barra de ruta es de lo que se está mirando, no de la ventana, y se
		// teletransporta a este hueco. Sin él la ventana pierde toda la
		// navegación y no hay ningún error: `querySelector` devuelve `null` y
		// el `Teleport` no dibuja en ningún lado. Ya pasó una vez.
		expect(abrir().find('.window-path-teleport-target').exists()).toBe(true);
	});

	test('y la barra lateral queda debajo de la barra, no a su costado', () => {
		// Es la diferencia que hacía que esta ventana se leyera distinta de
		// todas las demás: las pestañas y los botones son de la ventana, y con
		// la lateral comiéndose ese ancho no cruzaban entera.
		const ventana = abrir();
		const lateral = ventana.find('sidebar-component-stub').element;
		const barra = ventana.findComponent(AppBar).element;

		expect(barra.contains(lateral)).toBe(false);
		expect(barra.compareDocumentPosition(lateral) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
