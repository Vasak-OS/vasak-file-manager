<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { computed, ref, watch } from 'vue';
import ContextMenuItem from '@/components/ui/contextmenu/ContextMenuItem.vue';
import ContextMenuLabel from '@/components/ui/contextmenu/ContextMenuLabel.vue';
import ContextMenuSeparator from '@/components/ui/contextmenu/ContextMenuSeparator.vue';
import ContextMenuSubContent from '@/components/ui/contextmenu/ContextMenuSubContent.vue';
import ContextMenuSubTrigger from '@/components/ui/contextmenu/ContextMenuSubTrigger.vue';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import type { DirEntry } from '@/types/dir-entry';

interface AssociatedProgram {
	name: string;
	path: string;
	icon: string | null;
	is_default: boolean;
}

interface GetAssociatedProgramsResult {
	success: boolean;
	recommended_programs: AssociatedProgram[];
	other_programs: AssociatedProgram[];
	default_program: AssociatedProgram | null;
	error: string | null;
}

interface OpenWithResult {
	success: boolean;
	error: string | null;
}

const { t } = useI18n();

const props = defineProps<{
	selectedEntries: DirEntry[];
}>();

const emit = defineEmits<{
	openCustomDialog: [];
}>();

const isLoading = ref(false);
const recommendedPrograms = ref<AssociatedProgram[]>([]);
const defaultProgram = ref<AssociatedProgram | null>(null);
const loadError = ref<string | null>(null);

const firstEntry = computed(() => props.selectedEntries[0]);
const isDirectory = computed(() => firstEntry.value?.is_dir ?? false);
const lastLoadedPath = ref<string | null>(null);

async function loadAssociatedPrograms() {
	if (!firstEntry.value) return;

	const currentPath = firstEntry.value.path;
	if (currentPath === lastLoadedPath.value) return;

	isLoading.value = true;
	loadError.value = null;
	recommendedPrograms.value = [];
	defaultProgram.value = null;
	lastLoadedPath.value = currentPath;

	try {
		const result = await invoke<GetAssociatedProgramsResult>('get_associated_programs', {
			filePath: currentPath,
		});

		if (result.success) {
			recommendedPrograms.value = result.recommended_programs;
			defaultProgram.value = result.default_program;
		} else {
			loadError.value = result.error || 'openWith.failedToLoadPrograms';
		}
	} catch (invokeError) {
		loadError.value = String(invokeError);
	} finally {
		isLoading.value = false;
	}
}

watch(
	() => firstEntry.value?.path,
	() => {
		lastLoadedPath.value = null;
		loadAssociatedPrograms();
	},
	{ immediate: true }
);

async function openWithProgram(programPath: string) {
	try {
		for (const entry of props.selectedEntries) {
			const result = await invoke<OpenWithResult>('open_with_program', {
				filePath: entry.path,
				programPath: programPath,
				arguments: [],
			});

			if (!result.success) {
				console.error('Failed to open file:', result.error);
				return;
			}
		}
	} catch (invokeError) {
		console.error('Failed to open file:', invokeError);
	}
}

async function handleOpenNativeDialog() {
	if (!firstEntry.value) return;

	try {
		await invoke<OpenWithResult>('open_native_open_with_dialog', {
			filePath: firstEntry.value.path,
		});
	} catch (invokeError) {
		console.error('Failed to open native dialog:', invokeError);
	}
}

function handleOpenCustomDialog() {
	emit('openCustomDialog');
}
</script>

<template>
  <ContextMenuSub>
    <ContextMenuSubTrigger>
      <ExternalLinkIcon :size="16" />
      <span>{{ t('fileBrowser.actions.openWith') }}</span>
    </ContextMenuSubTrigger>
    <ContextMenuSubContent class="open-with-submenu">
      <div v-if="isLoading" class="open-with-submenu__loading">
        <Loader2Icon :size="16" class="open-with-submenu__spinner" />
        <span>{{ t('openWith.loadingPrograms') }}</span>
      </div>

      <template v-else-if="loadError">
        <div class="open-with-submenu__error">
          {{ loadError }}
        </div>
      </template>

      <template v-else>
        <template v-if="defaultProgram">
          <ContextMenuLabel class="open-with-submenu__label">
            {{ t('openWith.defaultApp') }}
          </ContextMenuLabel>
          <ContextMenuItem class="open-with-submenu__app" @select="openWithProgram(defaultProgram.path)">
            <img v-if="defaultProgram.icon" :src="defaultProgram.icon" class="open-with-submenu__app-icon" alt="">
            <FileIcon v-else :size="16" class="open-with-submenu__app-icon-fallback" />
            <span>{{ defaultProgram.name }}</span>
          </ContextMenuItem>
        </template>

        <template v-if="recommendedPrograms.length > 0">
          <ContextMenuSeparator v-if="defaultProgram" />
          <ContextMenuLabel class="open-with-submenu__label">
            {{ t('openWith.suggestedApps') }}
          </ContextMenuLabel>
          <ContextMenuItem v-for="program in recommendedPrograms" :key="program.path" class="open-with-submenu__app"
            @select="openWithProgram(program.path)">
            <img v-if="program.icon" :src="program.icon" class="open-with-submenu__app-icon" alt="">
            <FileIcon v-else :size="16" class="open-with-submenu__app-icon-fallback" />
            <span>{{ program.name }}</span>
          </ContextMenuItem>
        </template>

        <template v-if="!defaultProgram && recommendedPrograms.length === 0">
          <div class="open-with-submenu__empty">
            {{ t('openWith.noProgramsFound') }}
          </div>
        </template>

        <ContextMenuSeparator v-if="!isDirectory" />

        <ContextMenuItem v-if="!isDirectory" class="open-with-submenu__action" @select="handleOpenCustomDialog">
          <SettingsIcon :size="16" />
          <span>{{ t('openWith.customCommandWithFlags') }}</span>
        </ContextMenuItem>
      </template>
    </ContextMenuSubContent>
  </ContextMenuSub>
</template>

<style>
.open-with-submenu {
  min-width: 200px;
  max-width: 280px;
}

.open-with-submenu__loading {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  gap: 8px;
}

.open-with-submenu__spinner {
  animation: open-with-spin 1s linear infinite;
}

@keyframes open-with-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.open-with-submenu__error {
  padding: 8px 12px;
  color: hsl(var(--destructive));
  font-size: 13px;
}

.open-with-submenu__empty {
  padding: 8px 12px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}

.open-with-submenu__label {
  padding: 4px 8px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.open-with-submenu__app {
  display: flex;
  align-items: center;
  gap: 8px;
}

.open-with-submenu__app-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  object-fit: contain;
}

.open-with-submenu__app-icon-fallback {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
}

.open-with-submenu__action {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>