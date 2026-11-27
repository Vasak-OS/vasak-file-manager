<!-- SPDX-License-Identifier: GPL-3.0-or-later
License: GNU GPLv3 or later. See the license file in the project root for more information.
Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.
-->

<script setup lang="ts">
/**
 * Las pestañas del gestor de archivos, sobre la barra compartida.
 *
 * Lo que dibuja y cómo se comporta una pestaña —elegir, cerrar, reordenar, el
 * menú, el teclado, amoldarse a una barra vertical— es de
 * `@vasakgroup/vue-libvasak`: tres aplicaciones del escritorio tenían su propia
 * versión y ninguna hacía exactamente lo mismo. El desplegable del menú también:
 * el que había acá era un `div` por opción, sin `role` ni teclado.
 *
 * Lo que queda acá es lo que **sí** es del gestor: cómo se llama un grupo de
 * pestañas. Un grupo puede tener una o dos pestañas (vista dividida), y el
 * nombre muestra las dos separadas por una barra.
 */
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	type TabEntry,
	TabBar,
} from '@vasakgroup/vue-libvasak';
import { computed, nextTick, ref } from 'vue';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { Tab, TabGroup } from '@/types/workspaces';

const workspacesStore = useWorkspacesStore();
const { t } = useI18n();

const {
	openNewTabGroup,
	closeTabGroup,
	setTabs,
	openTabGroup,
	closeOtherTabGroups,
	closeAllTabGroups,
} = workspacesStore;

/** El menú de una pestaña, con el grupo sobre el que se abrió. */
const menuAbierto = ref(false);
const idDelMenu = ref<string | null>(null);
/**
 * Dónde se apretó, para que el menú salga ahí.
 *
 * El desplegable se ubica contra un elemento —le pide su rectángulo—, y la
 * librería emite coordenadas. El puente es un ancla de cero por cero fija en
 * ese punto: sin ella el menú no tenía contra qué medirse y salía en la esquina
 * de la ventana.
 */
const anclaDelMenu = ref({ x: 0, y: 0 });

const grupos = computed<TabGroup[]>(() => workspacesStore.currentWorkspace?.tabGroups ?? []);

/** Lo que muestra una pestaña: el nombre de la pestaña, o la carpeta. */
function etiquetaDe(tab: Tab): string {
	return tab.name || tab.path;
}

/** Un grupo partido en dos paneles muestra los dos. */
function etiquetaDelGrupo(grupo: TabGroup): string {
	const nombres = grupo.map(etiquetaDe).filter(Boolean);
	return nombres.join(' | ');
}

const pestanas = computed<TabEntry[]>(() =>
	grupos.value.map((grupo) => ({
		id: grupo[0]?.id ?? '',
		label: etiquetaDelGrupo(grupo),
		// El directorio entero en el texto de ayuda: en la pestaña sólo entra la
		// última carpeta, y dos proyectos con la misma última carpeta se ven
		// idénticos.
		tooltip: grupo[0]?.path || undefined,
	}))
);

const activa = computed(
	() => grupos.value[workspacesStore.currentWorkspace?.currentTabGroupIndex ?? 0]?.[0]?.id ?? ''
);

function grupoDe(id: string): TabGroup | undefined {
	return grupos.value.find((grupo) => grupo[0]?.id === id);
}

async function elegir(id: string) {
	const grupo = grupoDe(id);
	if (grupo) await openTabGroup(grupo);
}

async function cerrar(id: string) {
	const grupo = grupoDe(id);
	if (grupo) await closeTabGroup(grupo);
}

function abrirElMenu(carga: { id: string; x: number; y: number }) {
	idDelMenu.value = carga.id;
	anclaDelMenu.value = { x: carga.x, y: carga.y };
	// Si el menú ya está abierto, hay que cerrarlo y reabrirlo para que
	// DropdownMenuContent recalcule la posición con la nueva ancla.
	if (menuAbierto.value) {
		menuAbierto.value = false;
		nextTick(() => {
			menuAbierto.value = true;
		});
	} else {
		menuAbierto.value = true;
	}
}

// Sin cerrar el menú a mano: el ítem lo cierra al elegirse, y además devuelve
// el foco a donde estaba. Cerrarlo acá encima se lo saltea.
async function cerrarLasDemas() {
	if (idDelMenu.value) {
		const grupo = grupoDe(idDelMenu.value);
		if (grupo) await closeOtherTabGroups(grupo);
	}
}

async function cerrarTodas() {
	await closeAllTabGroups();
}

/** La lista nueva llega entera: se guarda tal cual. */
async function reordenar(nuevas: TabEntry[]) {
	const porId = new Map(grupos.value.map((grupo) => [grupo[0]?.id ?? '', grupo]));
	const ordenados = nuevas
		.map((pestana) => porId.get(pestana.id))
		.filter((grupo): grupo is TabGroup => Boolean(grupo));
	await setTabs(ordenados);
}
</script>

<template>
  <TabBar
    :tabs="pestanas"
    :model-value="activa"
    :new-label="t('tabs.newTab')"
    :close-label="t('tabs.close')"
    @select="elegir"
    @close="cerrar"
    @new="openNewTabGroup"
    @reorder="reordenar"
    @menu="abrirElMenu" />

  <DropdownMenu v-model:open="menuAbierto">
    <!-- El ancla: cero por cero, en el punto donde se abrió el menú. Es lo que
         el desplegable mide para ubicarse. -->
    <DropdownMenuTrigger as-child>
      <span
        class="pointer-events-none fixed size-0"
        :style="{ left: `${anclaDelMenu.x}px`, top: `${anclaDelMenu.y}px` }"
        aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem @select="cerrarLasDemas">{{ t('tabs.closeOtherTabs') }}</DropdownMenuItem>
      <DropdownMenuItem @select="cerrarTodas">{{ t('tabs.closeAllTabs') }}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>