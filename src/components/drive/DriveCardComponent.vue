<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ThemeIcon } from '@vasakgroup/vue-libvasak';
import { computed, markRaw, ref } from 'vue';
import CustomError from '@/components/ui/toast/CustomError.vue';
import { toast } from '@/components/ui/toast/toaster';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import { avisoDeFallo } from '@/tools/aviso-de-montaje';
import type { DriveInfo } from '@/types/drive-info';
import toReadableBytes from '@/utils/byte-parser';

const props = defineProps<{
	drive: DriveInfo;
}>();

const { t } = useI18n();
const workspacesStore = useWorkspacesStore();
const isMounting = ref(false);
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
		const mountPoint = await invoke<string>('mount_drive', { devicePath: props.drive.device_path });

		if (mountPoint) {
			await navigateToDrive(mountPoint);
		}
	} catch (mountError) {
		// Esto antes se iba a la consola y la ventana no mostraba nada: el clic
		// parecía no haber ocurrido. Ver `avisoDeFallo`.
		console.error('Failed to mount drive:', mountError);
		mostrarFallo(mountError);
	} finally {
		isMounting.value = false;
	}
}

function mostrarFallo(mountError: unknown) {
	const aviso = avisoDeFallo(mountError);

	// Cerrar el diálogo de la contraseña no es un fallo: no se avisa nada.
	if (!aviso) {
		return;
	}

	toast.custom(markRaw(CustomError), {
		componentProps: {
			title: t(aviso.claveDelTitulo),
			description: aviso.detalle,
		},
		duration: 6000,
	});
}

async function navigateToDrive(drivePath: string) {
	try {
		await workspacesStore.openNewTabGroup(drivePath);
	} catch (navigationError) {
		console.error('Failed to navigate to directory:', navigationError);
	}
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
  <button type="button" class="relative grid overflow-hidden w-full h-full items-center gap-0 pr-2 cursor-pointer [grid-template-columns:56px_1fr_auto] text-left hover:bg-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 transition-all" :class="{
    'opacity-60 hover:opacity-100': !drive.is_mounted,
  }" @click="handleClick">
    <div class="relative flex w-14 h-14 flex-col shrink-0 items-center justify-center gap-0.5">
        <ThemeIcon :name="driveIcon" :size="20" class="text-tx-muted" />
        <!-- El candado dice que ese clic va a pedir una frase de paso. Sin él,
             el diálogo aparece sin que nada lo anunciara. -->
        <ThemeIcon name="object-locked" :size="12" :alt="t('drive.encrypted')" class="absolute bottom-1 right-1" />
        <span v-if="drive.is_mounted" class="text-tx-muted text-[11px] font-medium">
          {{ drive.percent_used }}%
        </span>
    </div>

    <div class="flex min-w-0 flex-1 flex-col py-2 gap-1">
      <div class="overflow-hidden text-seccondary text-[13px] font-medium text-ellipsis whitespace-nowrap">
        {{ drive.name }}
      </div>

			<div class="flex items-center gap-2">
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-ui-surface/40">
					<div
						class="h-full rounded-full transition-all"
						:class="isLowSpace ? 'bg-status-error' : 'bg-primary'"
						:style="{ width: `${Math.min(100, Math.max(0, drive.percent_used))}%` }"
					/>
				</div>
				<span class="text-[11px] font-medium tabular-nums" :class="isLowSpace ? 'text-status-error' : 'text-tx-muted'">
					{{ drive.percent_used }}%
				</span>
			</div>

      <div class="text-tx-muted text-xs">
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
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-corner hover:bg-ui-surface/80 focus-visible:outline-2 focus-visible:outline-primary"
      :title="t('drive.unmount')"
      @click.stop.prevent="handleUnmount"
      @keydown.enter.stop.prevent="handleUnmount"
    >
      <ThemeIcon name="media-eject" :size="16" :alt="t('drive.eject')" />
    </span>
  </button>
</template>
