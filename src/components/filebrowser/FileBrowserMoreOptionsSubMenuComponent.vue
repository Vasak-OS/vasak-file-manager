<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { onMounted, ref } from 'vue';
import ContextMenuItem from '@/components/ui/contextmenu/ContextMenuItem.vue';
import ContextMenuSubContent from '@/components/ui/contextmenu/ContextMenuSubContent.vue';
import ContextMenuSubTrigger from '@/components/ui/contextmenu/ContextMenuSubTrigger.vue';
import type { DirEntry } from '@/types/dir-entry';

interface ShellContextMenuItem {
	id: number;
	name: string;
	verb: string | null;
	icon: string | null;
	children: ShellContextMenuItem[] | null;
}

interface GetShellContextMenuResult {
	success: boolean;
	items: ShellContextMenuItem[];
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

const isLoading = ref(false);
const menuItems = ref<ShellContextMenuItem[]>([]);
const loadError = ref<string | null>(null);
const hasLoadedForPath = ref<string | null>(null);

function filterMenuItems(items: ShellContextMenuItem[]): ShellContextMenuItem[] {
	return items
		.filter((item) => item.name && !item.name.startsWith('-'))
		.filter((item) => item.id > 0 || (item.children && item.children.length > 0))
		.map((item) => ({
			...item,
			children: item.children ? filterMenuItems(item.children) : null,
		}));
}

async function loadShellContextMenu() {
	const firstEntry = props.selectedEntries[0];
	if (!firstEntry) return;

	const currentPath = firstEntry.path;
	if (currentPath === hasLoadedForPath.value && menuItems.value.length > 0) return;

	isLoading.value = true;
	loadError.value = null;

	if (hasLoadedForPath.value !== currentPath) {
		menuItems.value = [];
	}

	hasLoadedForPath.value = currentPath;

	try {
		const result = await invoke<GetShellContextMenuResult>('get_shell_context_menu', {
			filePath: currentPath,
		});

		if (result.success) {
			menuItems.value = filterMenuItems(result.items);
		} else {
			loadError.value = result.error || 'moreOptions.failedToLoad';
		}
	} catch (invokeError) {
		loadError.value = String(invokeError);
	} finally {
		isLoading.value = false;
	}
}

onMounted(() => {
	loadShellContextMenu();
});

async function invokeMenuItem(commandId: number) {
	if (props.selectedEntries.length === 0 || !commandId) return;

	try {
		for (const entry of props.selectedEntries) {
			const result = await invoke<OpenWithResult>('invoke_shell_context_menu_item', {
				filePath: entry.path,
				commandId: commandId,
			});

			if (!result.success) {
				console.error('Failed to invoke shell command:', result.error);
				return;
			}
		}
	} catch (invokeError) {
		console.error('Failed to invoke shell command:', invokeError);
	}
}
</script>

<template>
  <ContextMenuSub>
    <ContextMenuSubTrigger>
      <MoreHorizontalIcon :size="16" />
      <span>{{ t('moreOptions.shellExtensions') }}</span>
    </ContextMenuSubTrigger>
    <ContextMenuSubContent class="min-w-[200px] max-w-[320px] py-1">
      <div class="max-h-[400px] overflow-y-auto [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-border">
        <div v-if="isLoading" class="flex items-center px-3 py-2 text-muted-foreground text-[13px] gap-2">
          <Loader2Icon :size="16" class="animate-spin" />
          <span>{{ t('moreOptions.loading') }}</span>
        </div>

        <template v-else-if="loadError">
          <div class="px-3 py-2 text-destructive text-[13px]">
            {{ loadError }}
          </div>
        </template>

        <template v-else>
          <template v-if="menuItems.length > 0">
            <template v-for="item in menuItems" :key="item.id || item.name">
              <ContextMenuSub v-if="item.children && item.children.length > 0">
                <ContextMenuSubTrigger class="flex items-center gap-2">
                  <span class="flex w-4 h-4 shrink-0 items-center justify-center">
                    <img v-if="item.icon" :src="item.icon" class="w-4 h-4 object-contain">
                  </span>
                  <span>{{ item.name }}</span>
                </ContextMenuSubTrigger>
                <ContextMenuSubContent class="min-w-[200px] max-w-[320px] py-1">
                  <div class="max-h-[300px] overflow-y-auto [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-border">
                    <ContextMenuItem v-for="child in item.children" :key="child.id" class="flex items-center gap-2"
                      @select="invokeMenuItem(child.id)">
                      <span class="flex w-4 h-4 shrink-0 items-center justify-center">
                        <img v-if="child.icon" :src="child.icon" class="w-4 h-4 object-contain">
                      </span>
                      <span>{{ child.name }}</span>
                    </ContextMenuItem>
                  </div>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuItem v-else class="flex items-center gap-2" @select="invokeMenuItem(item.id)">
                <span class="flex w-4 h-4 shrink-0 items-center justify-center">
                  <img v-if="item.icon" :src="item.icon" class="w-4 h-4 object-contain">
                </span>
                <span>{{ item.name }}</span>
              </ContextMenuItem>
            </template>
          </template>

          <template v-else>
            <div class="px-3 py-2 text-muted-foreground text-[13px]">
              {{ t('moreOptions.noOptionsAvailable') }}
            </div>
          </template>
        </template>
      </div>
    </ContextMenuSubContent>
  </ContextMenuSub>
</template>
