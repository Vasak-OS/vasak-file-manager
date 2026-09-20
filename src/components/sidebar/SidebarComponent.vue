<script lang="ts" setup>
/**
 * La barra lateral del gestor de archivos.
 *
 * Era una tira de 40 píxeles con íconos sueltos: un disco era un dibujo de USB
 * sin nombre, y para saber cuál era había que pasarle el puntero por encima y
 * esperar el tooltip. Con teclado no había manera de averiguarlo.
 *
 * Ahora es la barra de `@vasakgroup/vue-libvasak`, la misma que usan
 * Configuración, el monitor y la tienda: desplegada cada lugar y cada disco
 * llevan su nombre escrito, y plegada queda la tira de íconos de siempre —con
 * el nombre en el `title` y en el `aria-label`, que es lo que le faltaba.
 *
 * # Sin área de título
 *
 * No lleva `title` ni `subtitle`. El nombre de la ventana lo dice el gestor de
 * ventanas y la entrada del menú; escribirlo acá gastaría la mitad del alto de
 * la barra para repetir algo que ya está.
 *
 * # Por qué los discos conservan el tooltip
 *
 * El nombre alcanza para reconocerlo, pero no para decidir si ahí entra lo que
 * se quiere copiar. La tarjeta con el espacio libre, el sistema de archivos y
 * el botón de expulsar sigue apareciendo al pasar por encima.
 */
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { SideBar, SideButton, SideGroup } from '@vasakgroup/vue-libvasak';
import { onMounted } from 'vue';
import DriveCard from '@/components/drive/DriveCardComponent.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { type CloudDrive, useCloudDrives } from '@/composables/use-cloud-drives';
import { useDrives } from '@/composables/use-drives';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { DriveInfo } from '@/types/drive-info';

const { drives, refresh } = useDrives();
const {
	drives: cloudDrives,
	error: cloudError,
	montando,
	refresh: refreshCloud,
	mount: mountCloud,
} = useCloudDrives();
const workspacesStore = useWorkspacesStore();
const userPathsStore = useUserPathsStore();
const { t } = useI18n();

async function openDrive(path: string) {
	await workspacesStore.openNewTabGroup(path);
}

/** El ícono del tema que le corresponde a una unidad. */
function iconoDe(drive: DriveInfo): string {
	if (drive.drive_type === 'Network') return 'preferences-system-network-iscsi';
	return drive.is_removable ? 'drive-removable-media-usb' : 'drive-harddisk';
}

/** El nombre que oye un lector de pantalla, y lo que dice el tooltip. */
function etiquetaDe(nube: CloudDrive): string {
	return nube.necesita_reconectarse
		? t('cloudNeedsReconnect').replace('{0}', nube.nombre)
		: nube.nombre;
}

/**
 * Abre un disco en la nube: lo monta si hace falta y navega a su ruta.
 *
 * Se monta en vez de hablar WebDAV desde acá porque todo este gestor trabaja
 * sobre rutas —leer, previsualizar, buscar, arrastrar—. Con el montaje, lo que
 * se abre es una ruta de verdad y el resto del programa funciona sin enterarse.
 */
async function openCloudDrive(nube: CloudDrive) {
	// Una cuenta que hay que reconectar no se monta, pero el botón sigue
	// alcanzable: apretarlo dice qué falta en vez de no hacer nada.
	if (nube.necesita_reconectarse) {
		cloudError.value = etiquetaDe(nube);
		return;
	}
	const ruta = await mountCloud(nube.id);
	if (ruta) await openDrive(ruta);
}

onMounted(async () => {
	refresh();
	refreshCloud();
});
</script>

<template>
  <SideBar
    :collapse-label="t('barraLateral.plegar')"
    :expand-label="t('barraLateral.desplegar')">
    <template #default="{ collapsed }">
      <SideGroup :title="t('barraLateral.lugares')" :collapsed="collapsed">
        <SideButton
          :label="t('home')"
          icon="user-home"
          :collapsed="collapsed"
          @click="openDrive(userPathsStore.userPaths.homeDir)" />
        <SideButton
          :label="t('root')"
          icon="drive-harddisk"
          :collapsed="collapsed"
          @click="openDrive('/')" />
      </SideGroup>

      <SideGroup
        v-if="cloudDrives.length"
        :title="t('barraLateral.nube')"
        :collapsed="collapsed">
        <!-- Sólo `drive`: el correo es de la aplicación de correo y el
             calendario de la suya. -->
        <SideButton
          v-for="nube in cloudDrives"
          :key="nube.id"
          :label="etiquetaDe(nube)"
          icon="folder-cloud"
          :collapsed="collapsed"
          :disabled="montando === nube.id"
          :class="nube.necesita_reconectarse ? 'opacity-60' : ''"
          @click="openCloudDrive(nube)" />
      </SideGroup>

      <SideGroup
        v-if="drives.length"
        :title="t('barraLateral.discos')"
        :collapsed="collapsed">
        <Tooltip v-for="drive in drives" :key="drive.path" :delay-duration="0">
          <TooltipTrigger as-child>
            <SideButton
              :label="drive.name"
              :icon="iconoDe(drive)"
              :collapsed="collapsed"
              @click="openDrive(drive.path)" />
          </TooltipTrigger>
          <TooltipContent
            side="right"
            :side-offset="12"
            class="border-0 bg-transparent p-0">
            <DriveCard :drive="drive" />
          </TooltipContent>
        </Tooltip>
      </SideGroup>

      <!-- Si un montaje falló hay que decirlo. Antes el error se guardaba y no
           se mostraba: apretar el disco no hacía nada y no había forma de saber
           por qué. Va al final y no arriba para no correr de lugar todo lo
           demás cada vez que aparece. -->
      <p
        v-if="cloudError"
        role="status"
        class="mt-auto rounded-corner bg-status-error/20 p-2 text-status-error text-xs leading-relaxed">
        <span v-if="collapsed" aria-hidden="true">!</span>
        <span v-else>{{ cloudError }}</span>
        <span v-if="collapsed" class="sr-only">{{ cloudError }}</span>
      </p>
    </template>
  </SideBar>
</template>
