<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ComputedRef, computed, onMounted, Ref, ref } from 'vue';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { DriveInfo } from '@/types/drive-info';
import toReadableBytes from '@/utils/byte-parser';

const props = defineProps<{
	drive: DriveInfo;
}>();

const { t } = useI18n();
const workspacesStore = useWorkspacesStore();
const isMounting = ref(false);
const LOW_SPACE_THRESHOLD = 15;
const networkIcon: Ref<string> = ref('');
const usbIcon: Ref<string> = ref('');
const hardDriveIcon: Ref<string> = ref('');

const isLowSpace = computed(() => props.drive.percent_used >= 100 - LOW_SPACE_THRESHOLD);

const formattedSpaceInfo = computed(() => {
	if (!props.drive.is_mounted) {
		return t('driveNotMounted');
	}

	const available = toReadableBytes(props.drive.available_space, 1);
	const total = toReadableBytes(props.drive.total_space, 1);
	return `${available} ${t('freeOf')} ${total}`;
});

const driveIcon: ComputedRef<Ref<string>> = computed(() => {
	if (props.drive.drive_type === 'Network') {
		return networkIcon;
	}

	return props.drive.is_removable ? usbIcon : hardDriveIcon;
});

async function handleClick() {
	if (!props.drive.is_mounted) {
		await mountAndNavigate();
		return;
	}

	await navigateToDrive(props.drive.path);
}

async function mountAndNavigate() {
	isMounting.value = true;

	try {
		const mountPoint = await invoke<string>('mount_drive', { devicePath: props.drive.device_path });

		if (mountPoint) {
			await navigateToDrive(mountPoint);
		}
	} catch (mountError) {
		console.error('Failed to mount drive:', mountError);
	} finally {
		isMounting.value = false;
	}
}

async function navigateToDrive(drivePath: string) {
	try {
		await workspacesStore.openNewTabGroup(drivePath);
	} catch (navigationError) {
		console.error('Failed to navigate to directory:', navigationError);
	}
}

async function handleUnmount(clickEvent: MouseEvent) {
	clickEvent.stopPropagation();

	try {
		await invoke('unmount_drive', {
			devicePath: props.drive.device_path,
			mountPoint: props.drive.mount_point,
		});
	} catch (unmountError) {
		console.error('Failed to unmount drive:', unmountError);
	}
}

onMounted(async () => {
	networkIcon.value = await getIconSource('preferences-system-network-iscsi');
	usbIcon.value = await getIconSource('drive-removable-media-usb');
	hardDriveIcon.value = await getIconSource('drive-harddisk');
});
</script>

<template>
  <button type="button" class="relative grid rounded-corner overflow-hidden w-full h-full items-center gap-0 bg-ui-bg/80 border border-secondary pr-2 cursor-pointer [grid-template-columns:56px_1fr_auto] text-left hover:bg-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 transition-all" :class="{
    'opacity-60 hover:opacity-100': !drive.is_mounted,
  }" @click="handleClick">
    <div class="relative flex w-[56px] h-[56px] flex-col shrink-0 items-center justify-center gap-[2px]">
        <img :src="driveIcon.value" :size="20" class="text-tx-muted h-5 w-5" />
        <span v-if="drive.is_mounted" class="text-tx-muted text-[11px] font-medium">
          {{ drive.percent_used }}%
        </span>
    </div>

    <div class="flex min-w-0 flex-1 flex-col py-2 gap-1">
      <div class="overflow-hidden text-seccondary text-[13px] font-medium text-ellipsis whitespace-nowrap">
        {{ drive.name }}
      </div>

      <LinearBar :percent-used="drive.percent_used" :is-low-space="isLowSpace" />

      <div class="text-muted-foreground text-xs">
        <template v-if="isMounting">
          {{ t('mounting') }}...
        </template>
        <template v-else>
          {{ formattedSpaceInfo }}
        </template>
      </div>
    </div>
  </button>
</template>
