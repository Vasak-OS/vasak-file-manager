<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { getSymbolSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, onMounted, ref, watch } from 'vue';
import ContextMenuItem from '@/components/ui/contextmenu/ContextMenuItem.vue';
import ContextMenuLabel from '@/components/ui/contextmenu/ContextMenuLabel.vue';
import ContextMenuSeparator from '@/components/ui/contextmenu/ContextMenuSeparator.vue';
import ContextMenuSub from '@/components/ui/contextmenu/ContextMenuSub.vue';
import ContextMenuSubContent from '@/components/ui/contextmenu/ContextMenuSubContent.vue';
import ContextMenuSubTrigger from '@/components/ui/contextmenu/ContextMenuSubTrigger.vue';
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

const fileIcon = ref('');
const settingsIcon = ref('');
const externalLinkIcon = ref('');
const loaderIcon = ref('');

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

function handleOpenCustomDialog() {
	emit('openCustomDialog');
}

onMounted(async () => {
	fileIcon.value = await getSymbolSource('text-x-generic');
	settingsIcon.value = await getSymbolSource('settings-configure');
	externalLinkIcon.value = await getSymbolSource('external-link-symbolic');
	loaderIcon.value = await getSymbolSource('content-loading-symbolic');
});
</script>

<template>
  <ContextMenuSub>
    <ContextMenuSubTrigger class="flex gap-2">
      <img :src="externalLinkIcon" class="h-4 w-4" />
      <span>{{ t('fileBrowser.actions.openWith') }}</span>
    </ContextMenuSubTrigger>
	<ContextMenuSubContent class="min-w-50 max-w-70 overflow-visible">
      <div v-if="isLoading" class="flex items-center px-3 py-2 text-muted-foreground text-[13px] gap-2">
        <img :src="loaderIcon" class="animate-spin h-4 w-4" />
        <span>{{ t('openWith.loadingPrograms') }}</span>
      </div>

      <template v-else-if="loadError">
        <div class="px-3 py-2 text-destructive text-[13px]">
          {{ loadError }}
        </div>
      </template>

      <template v-else>
        <template v-if="defaultProgram">
          <ContextMenuLabel class="px-2 py-1 text-muted-foreground text-[11px] font-medium tracking-[0.03em] uppercase">
            {{ t('openWith.defaultApp') }}
          </ContextMenuLabel>
          <ContextMenuItem class="flex items-center gap-2" @select="openWithProgram(defaultProgram.path)">
            <img v-if="defaultProgram.icon" :src="defaultProgram.icon" class="w-4 h-4 shrink-0 object-contain" alt="">
            <img :src="fileIcon" v-else class="w-4 h-4 shrink-0 text-muted-foreground" />
            <span>{{ defaultProgram.name }}</span>
          </ContextMenuItem>
        </template>

        <template v-if="recommendedPrograms.length > 0">
          <ContextMenuSeparator v-if="defaultProgram" />
          <ContextMenuLabel class="px-2 py-1 text-muted-foreground text-[11px] font-medium tracking-[0.03em] uppercase">
            {{ t('openWith.suggestedApps') }}
          </ContextMenuLabel>
          <ContextMenuItem v-for="program in recommendedPrograms" :key="program.path" class="flex items-center gap-2"
            @select="openWithProgram(program.path)">
            <img v-if="program.icon" :src="program.icon" class="w-4 h-4 shrink-0 object-contain" alt="">
            <img :src="fileIcon" v-else class="w-4 h-4 shrink-0 text-muted-foreground" />
            <span>{{ program.name }}</span>
          </ContextMenuItem>
        </template>

        <template v-if="!defaultProgram && recommendedPrograms.length === 0">
          <div class="px-3 py-2 text-muted-foreground text-[13px]">
            {{ t('openWith.noProgramsFound') }}
          </div>
        </template>

        <ContextMenuSeparator v-if="!isDirectory" />

        <ContextMenuItem v-if="!isDirectory" class="flex items-center gap-2" @select="handleOpenCustomDialog">
          <img :src="settingsIcon" class="h-4 w-4" />
          <span>{{ t('openWith.customCommandWithFlags') }}</span>
        </ContextMenuItem>
      </template>
    </ContextMenuSubContent>
  </ContextMenuSub>
</template>
