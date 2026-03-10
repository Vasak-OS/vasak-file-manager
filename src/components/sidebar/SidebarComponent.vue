<script lang="ts" setup>
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { onMounted, ref } from 'vue';
import DriveCard from '@/components/drive/DriveCardComponent.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { useDrives } from '@/composables/use-drives';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useUserPathsStore } from '@/stores/storage/user-paths';
import { useWorkspacesStore } from '@/stores/storage/workspaces';

const { drives, refresh } = useDrives();
const workspacesStore = useWorkspacesStore();
const globalSearchStore = useGlobalSearchStore();
const userPathsStore = useUserPathsStore();
const { t } = useI18n();

const folderIcon = ref('');
const usbIcon = ref('');
const hardDriveIcon = ref('');
const searchIcon = ref('');
const homeIcon = ref('');
const rootIcon = ref('');

async function openDrive(path: string) {
	await workspacesStore.openNewTabGroup(path);
}

onMounted(async () => {
	folderIcon.value = await getIconSource('folder');
	usbIcon.value = await getIconSource('drive-removable-media-usb');
	hardDriveIcon.value = await getIconSource('drive-harddisk');
	searchIcon.value = await getIconSource('system-search');
	homeIcon.value = await getIconSource('user-home');
	rootIcon.value = await getIconSource('drive-harddisk');
	refresh();
});
</script>

<template>
  <div class="h-screen w-10 bg-ui-bg/80 rounded-l-corner-window justify-between flex flex-col p-1 border-r border-ui-border">
    
    <div class="flex flex-col gap-1 items-center mt-2">
      <div class="mb-2 p-1">
        <img :src="folderIcon" class="h-6 w-6 inline-block" alt="Logo">
      </div>
    </div>

    <div>
      <!--<Tooltip :delay-duration="0">
        <TooltipTrigger as-child>
          <button class="p-1 rounded-corner bg-ui-surface/80 hover:bg-primary" size="icon" @click="globalSearchStore.toggle()">
            <img :src="searchIcon" class="h-6 w-6" alt="Search" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="12">
          {{ t('search') }}
        </TooltipContent>
      </Tooltip>-->

      <Tooltip :delay-duration="0">
        <TooltipTrigger as-child>
          <button class="p-1 rounded-corner bg-ui-surface/80 hover:bg-primary" size="icon" @click="openDrive(userPathsStore.userPaths.homeDir)">
            <img :src="homeIcon" class="h-6 w-6" alt="Home" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="12">
          {{ t('home') }}
        </TooltipContent>
      </Tooltip>

      <Tooltip :delay-duration="0">
        <TooltipTrigger as-child>
          <button class="p-1 rounded-corner bg-ui-surface/80 hover:bg-primary" size="icon" @click="openDrive('/')">
            <img :src="rootIcon" class="h-6 w-6" alt="Root" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="12">
          {{ t('root') }}
        </TooltipContent>
      </Tooltip>
    </div>

    <div>
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