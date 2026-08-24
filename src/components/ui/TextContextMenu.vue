<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import type { MenuEntry } from '@vasakgroup/plugin-vsk-contextual-menu';
import { useContextMenu } from '@vasakgroup/plugin-vsk-contextual-menu';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { onBeforeUnmount, onMounted } from 'vue';

/**
 * El menú del clic derecho sobre los campos de texto.
 *
 * El menú propio del gestor es el de los archivos: copiar, pegar, abrir con,
 * comprimir. Sobre un campo de texto —renombrar, la barra de direcciones, el
 * buscador— no ofrece nada, y con el menú del motor apagado —lo apaga el plugin
 * al arrancar— no quedaría forma de pegar con el ratón. Este es ese pedazo.
 *
 * Se monta una sola vez y escucha en el documento: los diálogos aparecen y
 * desaparecen, y ninguno tiene que acordarse de nada.
 */
const { t } = useI18n();
const { show } = useContextMenu();

/** Los deslizadores, las casillas y los interruptores también son `input`, y no
 * tienen texto que copiar. */
const TIPOS_CON_TEXTO = ['text', 'search', 'url', 'email', 'tel', 'number', 'password'];

const campoDeTexto = (
	elemento: EventTarget | null
): HTMLInputElement | HTMLTextAreaElement | null => {
	if (elemento instanceof HTMLTextAreaElement) return elemento;

	if (elemento instanceof HTMLInputElement && TIPOS_CON_TEXTO.includes(elemento.type)) {
		return elemento;
	}

	return null;
};

/**
 * El portapapeles pasa por Rust, no por el navegador.
 *
 * WebKitGTK no implementa el permiso «clipboard-read», así que
 * `navigator.clipboard.readText()` no devuelve nada y «Pegar» no haría nada, sin
 * avisar. GTK sí puede leerlo; y para no tener dos caminos con comportamientos
 * distintos —uno de ellos sin `store()`, que es lo que hace que lo copiado
 * sobreviva al cierre de la ventana—, copiar también va por ahí.
 */
const copiar = async (texto: string) => {
	try {
		await invoke('clipboard_write_text', { text: texto });
	} catch (error) {
		console.warn('No se pudo copiar al portapapeles:', error);
	}
};

/**
 * Reemplaza la selección del campo respetando a Vue.
 *
 * `setRangeText` cambia el valor del elemento sin que `v-model` se entere, así
 * que hay que avisar con un evento `input`: sin eso lo pegado se ve en pantalla
 * y se pierde al guardar.
 */
const insertar = (campo: HTMLInputElement | HTMLTextAreaElement, texto: string) => {
	const desde = campo.selectionStart ?? campo.value.length;
	const hasta = campo.selectionEnd ?? campo.value.length;

	campo.focus();
	campo.setRangeText(texto, desde, hasta, 'end');
	campo.dispatchEvent(new Event('input', { bubbles: true }));
};

const abrir = async (evento: MouseEvent) => {
	const campo = campoDeTexto(evento.target);

	// Sin campo no hay nada que ofrecer, y un menú con todo deshabilitado es
	// peor que ningún menú. El del motor ya está apagado en toda la ventana.
	if (!campo) return;

	const seleccion = campo.value.slice(campo.selectionStart ?? 0, campo.selectionEnd ?? 0);
	const editable = !campo.readOnly && !campo.disabled;

	// Una contraseña es la única cosa que no debería poder salir al portapapeles
	// con dos clics: quedan pegar y seleccionar todo, que es para lo que alguien
	// abre el menú sobre un campo así.
	const puedeCopiar = seleccion.length > 0 && campo.type !== 'password';

	const opciones: MenuEntry[] = [];

	if (puedeCopiar) {
		opciones.push({
			id: 'copiar',
			label: t('textMenu.copy'),
			icon: 'edit-copy',
			accelerator: 'Ctrl+C',
		});
	}

	if (puedeCopiar && editable) {
		opciones.push({
			id: 'cortar',
			label: t('textMenu.cut'),
			icon: 'edit-cut',
			accelerator: 'Ctrl+X',
		});
	}

	if (editable) {
		opciones.push({
			id: 'pegar',
			label: t('textMenu.paste'),
			icon: 'edit-paste',
			accelerator: 'Ctrl+V',
		});
	}

	opciones.push({
		id: 'seleccionar-todo',
		label: t('textMenu.selectAll'),
		icon: 'edit-select-all',
		accelerator: 'Ctrl+A',
	});

	const elegido = await show(opciones, evento);

	if (elegido?.id === 'copiar') {
		await copiar(seleccion);
	}

	if (elegido?.id === 'cortar') {
		await copiar(seleccion);
		insertar(campo, '');
	}

	if (elegido?.id === 'pegar') {
		try {
			insertar(campo, await invoke<string>('clipboard_read_text'));
		} catch (error) {
			console.warn('No se pudo leer el portapapeles:', error);
		}
	}

	if (elegido?.id === 'seleccionar-todo') {
		campo.focus();
		campo.select();
	}
};

onMounted(() => {
	// En captura, igual que la supresión del menú del motor, y antes que
	// cualquier elemento de la página.
	document.addEventListener('contextmenu', abrir, { capture: true });
});

onBeforeUnmount(() => {
	document.removeEventListener('contextmenu', abrir, { capture: true });
});
</script>

<template />
