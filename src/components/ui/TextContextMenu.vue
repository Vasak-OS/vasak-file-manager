<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import type { MenuEntry } from '@vasakgroup/plugin-vsk-contextual-menu';
import { useContextMenu } from '@vasakgroup/plugin-vsk-contextual-menu';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { onBeforeUnmount, onMounted } from 'vue';
import {
	campoDeTexto,
	ejecutarAccion,
	esAccionDeTexto,
	type Portapapeles,
} from '@/components/ui/text-context-menu';

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

/**
 * El portapapeles pasa por Rust, no por el navegador.
 *
 * WebKitGTK no implementa el permiso «clipboard-read», así que
 * `navigator.clipboard.readText()` no devuelve nada y «Pegar» no haría nada, sin
 * avisar. GTK sí puede leerlo; y para no tener dos caminos con comportamientos
 * distintos —uno de ellos sin `store()`, que es lo que hace que lo copiado
 * sobreviva al cierre de la ventana—, copiar también va por ahí.
 */
const portapapeles: Portapapeles = {
	leer: () => invoke<string | null>('clipboard_read_text'),
	escribir: async (texto: string) => {
		await invoke('clipboard_write_text', { text: texto });
	},
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
	if (!elegido || !esAccionDeTexto(elegido.id)) return;

	await ejecutarAccion(elegido.id, campo, seleccion, portapapeles);
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
