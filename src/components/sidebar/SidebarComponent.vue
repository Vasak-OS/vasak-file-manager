<script lang="ts" setup>
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { onMounted } from 'vue';
import DriveCard from '@/components/drive/DriveCardComponent.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { useCloudDrives } from '@/composables/use-cloud-drives';
import { useDrives } from '@/composables/use-drives';
import { useReactiveIcon } from '@/composables/useReactiveIcon';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useWorkspacesStore } from '@/stores/storage/workspaces';

const { drives, refresh } = useDrives();
const {
	drives: cloudDrives,
	montando,
	refresh: refreshCloud,
	mount: mountCloud,
} = useCloudDrives();
const workspacesStore = useWorkspacesStore();
const userPathsStore = useUserPathsStore();
const { t } = useI18n();

const folderIcon = useReactiveIcon(() => getIconSource('folder'));
const usbIcon = useReactiveIcon(() => getIconSource('drive-removable-media-usb'));
const hardDriveIcon = useReactiveIcon(() => getIconSource('drive-harddisk'));
const homeIcon = useReactiveIcon(() => getIconSource('user-home'));
const rootIcon = useReactiveIcon(() => getIconSource('drive-harddisk'));
const cloudIcon = useReactiveIcon(() => getIconSource('folder-cloud'));

async function openDrive(path: string) {
	await workspacesStore.openNewTabGroup(path);
}

/**
 * Abre un disco en la nube: lo monta si hace falta y navega a su ruta.
 *
 * Se monta en vez de hablar WebDAV desde acá porque todo este gestor trabaja
 * sobre rutas — leer, previsualizar, buscar, arrastrar—. Con el montaje, lo que
 * se abre es una ruta de verdad y el resto del programa funciona sin enterarse.
 */
async function openCloudDrive(id: string) {
	const ruta = await mountCloud(id);
	if (ruta) await openDrive(ruta);
}

onMounted(async () => {
	refresh();
	refreshCloud();
});
</script>

<template>
  <div class="h-screen w-10 bg-ui-bg/80 rounded-l-corner-window justify-between flex flex-col p-1 border-r border-ui-border">
    
    <div class="flex flex-col gap-1 items-center mt-2">
      <div class="mb-2 p-1">
        <img :src="folderIcon" class="h-6 w-6 inline-block" alt="">
      </div>
    </div>

    <div>
      <!--<Tooltip :delay-duration="0">
        <TooltipTrigger as-child>
          <button class="p-1 rounded-corner bg-ui-surface/80 hover:bg-primary" size="icon" @click="globalSearchStore.toggle()" :aria-label="t('search')">
            <img :src="searchIcon" class="h-6 w-6" :alt="t('search')" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="12">
          {{ t('search') }}
        </TooltipContent>
      </Tooltip>-->

      <Tooltip :delay-duration="0">
        <TooltipTrigger as-child>
          <button class="p-1 rounded-corner bg-ui-surface/80 hover:bg-primary" size="icon" @click="openDrive(userPathsStore.userPaths.homeDir)" :aria-label="t('home')">
            <img :src="homeIcon" class="h-6 w-6" :alt="t('home')" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="12">
          {{ t('home') }}
        </TooltipContent>
      </Tooltip>

      <Tooltip :delay-duration="0">
        <TooltipTrigger as-child>
          <button class="p-1 rounded-corner bg-ui-surface/80 hover:bg-primary" size="icon" @click="openDrive('/')" :aria-label="t('root')">
            <img :src="rootIcon" class="h-6 w-6" :alt="t('root')" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="12">
          {{ t('root') }}
        </TooltipContent>
      </Tooltip>
    </div>

    <div>
      <!-- Los discos en la nube de las cuentas conectadas. Sólo `drive`: el
           correo es de la aplicación de correo y el calendario de la suya. -->
      <Tooltip v-for="nube in cloudDrives" :key="nube.id" :delay-duration="0">
        <TooltipTrigger as-child>
          <button
            class="p-1 rounded-corner bg-ui-surface/80 hover:bg-primary disabled:opacity-50"
            size="icon"
            :disabled="montando === nube.id || nube.necesita_reconectarse"
            @click="openCloudDrive(nube.id)"
          >
            <img
              :src="cloudIcon"
              class="nav-sidebar-drive-icon h-6 w-6"
              :class="nube.necesita_reconectarse && 'grayscale'"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <!-- El motivo, no un botón apagado sin explicación: la persona tiene
               que saber que le falta reconectarla desde Configuración. -->
          {{
            nube.necesita_reconectarse
              ? t('cloudNeedsReconnect').replace('{0}', nube.nombre)
              : nube.nombre
          }}
        </TooltipContent>
      </Tooltip>

      <Tooltip v-for="drive in drives" :key="drive.path" :delay-duration="0">
        <TooltipTrigger as-child>
          <button class="p-1 rounded-corner bg-ui-surface/80 hover:bg-primary" size="icon" @click="openDrive(drive.path)">
            <img :src="drive.is_removable ? usbIcon : hardDriveIcon" class="nav-sidebar-drive-icon h-6 w-6" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="12" :collision-padding="6" class="p-0 border-0 bg-transparent">
          <DriveCard :drive="drive" />
        </TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>