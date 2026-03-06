<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, ComputedRef, onMounted, onUnmounted, Ref, ref } from 'vue';
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

const driveIcon : ComputedRef<Ref<string>> = computed(() => {
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
  <button type="button" class="drive-card relative grid rounded-corner overflow-hidden w-full h-full items-center gap-0 bg-ui-bg/80 border border-secondary" :class="{
    'drive-card--unmounted': !drive.is_mounted,
  }" @click="handleClick">
    <div class="drive-card__preview">
        <img :src="driveIcon.value" :size="20" class="drive-card__icon h-5 w-5" />
        <span v-if="drive.is_mounted" class="drive-card__percent">
          {{ drive.percent_used }}%
        </span>
    </div>

    <div class="drive-card__content">
      <div class="drive-card__name">
        {{ drive.name }}
      </div>

      <LinearBar :percent-used="drive.percent_used" :is-low-space="isLowSpace" />

      <div class="drive-card__space-info">
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

<style>
.drive-card {
  padding: 0 8px 0 0;
  cursor: pointer;
  grid-template-columns: 56px 1fr auto;
  text-align: left;
}

.drive-card:hover {
  background-color: hsl(var(--muted));
}

.drive-card:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

.drive-card--unmounted {
  opacity: 0.6;
}

.drive-card--unmounted:hover {
  opacity: 1;
}

.drive-card__preview {
  position: relative;
  display: flex;
  width: 56px;
  height: 56px;
  flex-direction: column;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.drive-card--circular .drive-card__preview {
  width: 60px;
  height: 60px;
}

.drive-card__icon {
  color: hsl(var(--muted-foreground));
}

.drive-card__percent {
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 500;
}

.drive-card__content {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding: 8px 0;
  gap: 4px;
}

.drive-card__name {
  overflow: hidden;
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drive-card__space-info {
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}

.drive-card__eject {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.drive-card:hover .drive-card__eject {
  opacity: 1;
}

.drive-card__eject:hover {
  background-color: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}
</style>