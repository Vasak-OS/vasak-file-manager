/**
 * Los diálogos y los tooltips, ahora los de la librería.
 *
 * El gestor de archivos tenía las dos familias enteras escritas acá: seis
 * piezas de diálogo y tres de tooltip, usadas entre las dos en quince
 * archivos. El tooltip estaba además copiado byte a byte en vasak-terminal, y
 * las copias ya habían divergido.
 *
 * Nada de esto tenía prueba. Lo que se comprueba acá es lo que cambia al
 * mudarse —que el diálogo ahora **se teletransporta al `body`**, así que deja
 * de colgar de quien lo abrió— y lo que el diálogo de acá gana con la mudanza:
 * el Tab que da la vuelta adentro, que la copia local no hacía aunque
 * declaraba `aria-modal`.
 *
 * Lo demás —cómo se abre, cómo se cierra, el retardo del tooltip— es de la
 * librería y se prueba allá, montado y saboteado.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { olvidarLosIconosDelTema } from '@vasakgroup/vue-libvasak';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import RenameDialogComponent from '@/components/dialogs/RenameDialogComponent.vue';
import { olvidarTodo } from './dobles';

let vista: VueWrapper | null = null;

/**
 * Monta cerrado y abre, que es como lo usa la aplicación.
 *
 * El componente llena el campo en un `watch` sobre `open`, y un `watch` no
 * corre para el valor inicial: montarlo ya abierto lo dejaría vacío. El padre
 * lo monta con la bandera en falso y la da vuelta, así que ése es el camino.
 */
async function abrirElDeRenombrar(nombre = 'informe.txt') {
	vista = mount(RenameDialogComponent, {
		props: {
			open: false,
			entry: { name: nombre, path: `/home/${nombre}`, is_dir: false } as never,
		},
		attachTo: document.body,
	});
	await vista.setProps({ open: true });
	await nextTick();
	await nextTick();
	return vista;
}

/** El panel, que no cuelga del montaje: vive en el `body`. */
const elPanel = () => document.body.querySelector<HTMLElement>('[role="dialog"]');

beforeEach(() => {
	olvidarTodo();
	olvidarLosIconosDelTema();
	setActivePinia(createPinia());
});

afterEach(() => {
	vista?.unmount();
	vista = null;
	// El panel se teletransporta, así que no se va con el desmontaje. Sin esto
	// lo encuentra la prueba siguiente y falla por algo que no es suyo.
	for (const suelto of document.body.querySelectorAll('[role="dialog"]')) {
		suelto.parentElement?.remove();
	}
});

describe('el diálogo de renombrar', () => {
	test('se dibuja en el `body` y no adentro de quien lo abrió', async () => {
		// Es lo que evita que un diálogo quede recortado por el `overflow` de la
		// lista de archivos, y lo que hace que su `z-index` compita con el de la
		// ventana y no con el del contenedor que le tocó.
		const v = await abrirElDeRenombrar();

		expect(elPanel()).not.toBeNull();
		expect(v.element.contains(elPanel())).toBe(false);
	});

	test('y se anuncia con su título, no con un nombre escrito aparte', async () => {
		// La copia de acá ponía `aria-label` a mano; ahora el nombre sale del
		// `DialogTitle` por `aria-labelledby`, así que lo que se oye es el mismo
		// texto que se ve y no pueden desfasarse.
		await abrirElDeRenombrar();

		const id = elPanel()?.getAttribute('aria-labelledby');
		expect(id).toBeTruthy();
		expect(document.getElementById(id as string)?.textContent).toContain(
			'dialogs.renameDirItemDialog.renameItem'
		);
	});

	test('el formulario de adentro sigue funcionando', async () => {
		// Es lo que se rompería si la mudanza hubiera dejado el contenido fuera
		// de la ranura: el campo y el botón viven adentro del panel.
		const v = await abrirElDeRenombrar('informe.txt');

		const campo = elPanel()?.querySelector<HTMLInputElement>('#rename-input');
		expect(campo).not.toBeNull();
		expect(campo?.value).toBe('informe.txt');

		// Se reemplaza el contenido entero, así que lo que sale es eso y no
		// «memoria.txt»: la extensión la conserva quien escribe, porque al abrir
		// queda seleccionado sólo el tronco del nombre.
		(campo as HTMLInputElement).value = 'memoria';
		campo?.dispatchEvent(new Event('input'));
		await nextTick();

		const guardar = [...(elPanel()?.querySelectorAll('button') ?? [])].find(
			(b) => b.textContent?.trim() === 'save'
		);
		expect(guardar).toBeDefined();
		expect((guardar as HTMLButtonElement).disabled).toBe(false);
		(guardar as HTMLButtonElement).click();
		await nextTick();

		expect(v.emitted('confirm')?.[0]).toEqual(['memoria']);
	});

	test('el Tab da la vuelta adentro, que es lo que esta copia no hacía', async () => {
		// La copia local declaraba `aria-modal="true"` y no lo cumplía: el Tab
		// seguía recorriendo la lista de archivos que quedaba detrás del velo,
		// invisible pero alcanzable.
		// Se escribe primero: con el nombre sin cambiar, el botón de guardar
		// está apagado y no cuenta como alcanzable, así que el único que queda
		// es el campo y el recorrido no tendría vuelta que dar.
		await abrirElDeRenombrar();
		const campo = elPanel()?.querySelector<HTMLInputElement>('#rename-input') as HTMLInputElement;
		campo.value = 'memoria';
		campo.dispatchEvent(new Event('input'));
		await nextTick();

		const alcanzables = [
			...(elPanel()?.querySelectorAll('input:not([disabled]), button:not([disabled])') ?? []),
		] as HTMLElement[];
		expect(alcanzables.length).toBeGreaterThan(1);
		const ultimo = alcanzables[alcanzables.length - 1];
		ultimo.focus();

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
		await nextTick();

		expect(document.activeElement).toBe(alcanzables[0]);
	});

	test('y el foco entra al panel al abrirse', async () => {
		// Sin esto el teclado se queda detrás del velo y hay que hacer un clic
		// para entrar al diálogo.
		await abrirElDeRenombrar();

		expect(document.activeElement).toBe(elPanel());
	});
});
