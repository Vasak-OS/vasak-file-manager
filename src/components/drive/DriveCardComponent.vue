<!-- SPDX-License-Identifier: GPL-3.0-or-later
License: GNU GPLv3 or later. See the license file in the project root for more information.
Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.
-->

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { useContextMenu } from '@vasakgroup/plugin-vsk-contextual-menu';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ProgressBar, ThemeIcon } from '@vasakgroup/vue-libvasak';
import { computed, ref } from 'vue';
import { useMountDrive } from '@/composables/use-mount-drive';
import { requestRename } from '@/composables/use-rename-volume-label';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { DriveInfo } from '@/types/drive-info';
import toReadableBytes from '@/utils/byte-parser';

const props = defineProps<{
	drive: DriveInfo;
}>();

const { t } = useI18n();
const workspacesStore = useWorkspacesStore();
const isMounting = ref(false);
const { mountDrive } = useMountDrive();
const { show } = useContextMenu();
const LOW_SPACE_THRESHOLD = 15;

const isLowSpace = computed(() => props.drive.percent_used >= 100 - LOW_SPACE_THRESHOLD);

const formattedSpaceInfo = computed(() => {
	if (!props.drive.is_mounted) {
		// Una unidad cifrada sin abrir no está «no montada» a secas: hace falta la
		// frase de paso, y decirlo antes del clic evita que el diálogo aparezca
		// como una sorpresa.
		return props.drive.is_encrypted ? t('drive.encryptedLocked') : t('driveNotMounted');
	}

	const available = toReadableBytes(props.drive.available_space, 1);
	const total = toReadableBytes(props.drive.total_space, 1);
	return `${available} ${t('freeOf')} ${total}`;
});

// Devuelve el **nombre** del icono y no un `Ref` con la fuente ya resuelta:
// resolverlo, memorizarlo y volver a resolverlo al cambiar el tema es cosa de
// `ThemeIcon`. De paso se va el `ComputedRef<Ref<…>>`, que era un ref adentro
// de otro porque cada icono traía el suyo.
const driveIcon = computed(() => {
	if (props.drive.drive_type === 'Network') {
		return 'preferences-system-network-iscsi';
	}

	return props.drive.is_removable ? 'drive-removable-media-usb' : 'drive-harddisk';
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
		const mountPoint = await mountDrive(props.drive);
		if (mountPoint) {
			await navigateToDrive(mountPoint);
		}
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

/**
 * Menú del clic derecho de la unidad. Hoy sólo renombra la etiqueta; el diálogo
 * vive en la barra lateral (ver `use-rename-volume-label`) porque esta tarjeta
 * está dentro de un tooltip, que se desmonta apenas el puntero se va al menú.
 */
async function handleContextMenu(event: MouseEvent) {
	// `SetLabel` sólo vale sobre un sistema de archivos montable. Una unidad de red
	// (device_path no-/dev/) y un volumen LUKS cifrado sin abrir (su bloque es
	// `Encrypted`, no `Filesystem`) siempre fallarían, así que no se ofrece renombrar.
	if (!props.drive.device_path.startsWith('/dev/') || props.drive.is_encrypted) return;

	const chosen = await show(
		[{ id: 'rename-label', label: t('drive.rename'), icon: 'edit-rename' }],
		{
			x: event.clientX,
			y: event.clientY,
		}
	);

	if (chosen?.id === 'rename-label') requestRename(props.drive);
}

async function handleUnmount(clickEvent?: Event) {
	clickEvent?.stopPropagation();

	try {
		await invoke('unmount_drive', {
			devicePath: props.drive.device_path,
			mountPoint: props.drive.mount_point,
		});
	} catch (unmountError) {
		console.error('Failed to unmount drive:', unmountError);
	}
}
</script>

<template>
  <button type="button" class="relative grid overflow-hidden w-full h-full items-center gap-0 pr-2 cursor-pointer rounded-corner-m [grid-template-columns:56px_1fr_auto] text-left text-tx-main transition-colors duration-200 ease-ui hover:bg-ui-hover active:bg-ui-pressed focus-visible:outline-2 focus-visible:outline-ui-focus focus-visible:outline-offset-2" :class="{
    'opacity-60 hover:opacity-100': !drive.is_mounted,
  }" @click="handleClick" @contextmenu.prevent="handleContextMenu">
    <div class="relative flex w-14 h-14 flex-col shrink-0 items-center justify-center gap-0.5">
        <ThemeIcon :name="driveIcon" :size="20" class="text-tx-muted" />
        <!-- El candado dice que ese clic va a pedir una frase de paso. Sin él,
             el diálogo aparece sin que nada lo anunciara. -->
        <ThemeIcon
          v-if="drive.is_encrypted"
          name="object-locked"
          :size="12"
          :alt="t('drive.encrypted')"
          class="absolute bottom-1 right-1" />
        <span v-if="drive.is_mounted" class="text-tx-muted text-label-xs font-medium">
          {{ drive.percent_used }}%
        </span>
    </div>

    <div class="flex min-w-0 flex-1 flex-col py-2 gap-1">
      <div class="overflow-hidden text-tx-main text-label-s font-medium text-ellipsis whitespace-nowrap">
        {{ drive.name }}
      </div>

			<div class="flex items-center gap-2">
				<ProgressBar
					:value="Math.min(100, Math.max(0, drive.percent_used))"
					:label="drive.name"
					:tone="isLowSpace ? 'critical' : 'normal'"
					size="sm"
					class="min-w-0 flex-1" />
				<span class="text-label-xs font-medium tabular-nums" :class="isLowSpace ? 'text-status-error' : 'text-tx-muted'">
					{{ drive.percent_used }}%
				</span>
			</div>

      <div class="text-tx-muted text-body-xs">
        <template v-if="isMounting">
          {{ t('mounting') }}...
        </template>
        <template v-else>
          {{ formattedSpaceInfo }}
        </template>
      </div>
    </div>

    <span
      v-if="drive.is_mounted && drive.is_removable"
      role="button"
      tabindex="0"
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-corner-m transition-colors duration-200 ease-ui hover:bg-ui-hover active:bg-ui-pressed focus-visible:outline-2 focus-visible:outline-ui-focus"
      :title="t('drive.unmount')"
      @click.stop.prevent="handleUnmount"
      @keydown.enter.stop.prevent="handleUnmount"
    >
      <ThemeIcon name="media-eject" :size="16" :alt="t('drive.eject')" />
    </span>
  </button>
</template>
