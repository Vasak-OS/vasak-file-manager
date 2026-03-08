<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed } from 'vue';
import ContextMenuItem from '@/components/ui/contextmenu/ContextMenuItem.vue';
import ContextMenuLabel from '@/components/ui/contextmenu/ContextMenuLabel.vue';
import ContextMenuSeparator from '@/components/ui/contextmenu/ContextMenuSeparator.vue';
import ContextMenuSubContent from '@/components/ui/contextmenu/ContextMenuSubContent.vue';
import ContextMenuSubTrigger from '@/components/ui/contextmenu/ContextMenuSubTrigger.vue';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useTerminalsStore } from '@/stores/runtime/terminals';
import type { DirEntry } from '@/types/dir-entry';

const props = defineProps<{
	selectedEntries: DirEntry[];
	isShiftHeld: boolean;
}>();

const { t } = useI18n();
const shortcutsStore = useShortcutsStore();
const terminalsStore = useTerminalsStore();

const ADMIN_MODIFIER_KEY = 'Shift';

const targetDirectoryPath = computed(() => {
	const firstEntry = props.selectedEntries[0];
	if (!firstEntry) return null;

	if (firstEntry.is_dir) {
		return firstEntry.path;
	}

	const lastSeparator = Math.max(
		firstEntry.path.lastIndexOf('/'),
		firstEntry.path.lastIndexOf('\\')
	);

	if (lastSeparator > 0) {
		return firstEntry.path.substring(0, lastSeparator);
	}

	return firstEntry.path;
});

async function handleOpenTerminal(terminalId: string) {
	if (!targetDirectoryPath.value) return;

	await terminalsStore.openTerminal(targetDirectoryPath.value, terminalId, props.isShiftHeld);
}
</script>

<template>
  <ContextMenuSub>
    <ContextMenuSubTrigger class="flex items-center gap-2">
      <TerminalSquareIcon :size="16" />
      <span>{{ t('terminal.openInTerminal') }}</span>
      <kbd class="ml-auto opacity-60">{{ shortcutsStore.getShortcutLabel('openTerminal') }}</kbd>
    </ContextMenuSubTrigger>
    <ContextMenuSubContent class="min-w-[200px] max-w-[350px]">
      <template v-if="terminalsStore.loadError">
        <div class="px-3 py-2 text-destructive text-[13px]">
          {{ terminalsStore.loadError }}
        </div>
      </template>

      <template v-else-if="terminalsStore.hasLoaded && terminalsStore.terminals.length === 0">
        <div class="px-3 py-2 text-muted-foreground text-[13px]">
          {{ t('terminal.noTerminalsFound') }}
        </div>
      </template>

      <template v-else>
        <ContextMenuLabel class="flex items-center px-2 py-1 text-muted-foreground text-[11px] italic gap-2">
          <i18n-t keypath="terminal.holdModifierForAdmin" tag="span">
            <template #modifier>
              <kbd>{{ ADMIN_MODIFIER_KEY }}</kbd>
            </template>
          </i18n-t>
          <kbd class="ml-auto not-italic opacity-60">{{ shortcutsStore.getShortcutLabel('openTerminalAdmin')
            }}</kbd>
        </ContextMenuLabel>

        <ContextMenuSeparator />

        <ContextMenuItem v-for="terminal in terminalsStore.terminals" :key="terminal.id" class="flex items-center gap-2"
          @select="handleOpenTerminal(terminal.id)">
          <img v-if="terminal.icon" :src="terminal.icon" class="w-4 h-4 shrink-0 object-contain">
          <TerminalSquareIcon v-else :size="16" />
          <span>{{ terminal.name }}</span>
          <span v-if="terminal.isDefault" class="ml-auto text-muted-foreground text-[11px] opacity-70">
            {{ t('terminal.defaultLabel') }}
          </span>
        </ContextMenuItem>
      </template>
    </ContextMenuSubContent>
  </ContextMenuSub>
</template>
