<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import TabComponent from '@/components/tab/TabComponent.vue';
import TabDraggableComponent from '@/components/tab/TabDraggableComponent.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { useShortcutsStore } from '@/stores/runtime/shortcuts';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import { getSymbolSource } from '@vasakgroup/plugin-vicons';
import type { TabGroup, Tab as TabType } from '@/types/workspaces';

const props = withDefaults(
	defineProps<{
		teleportTarget?: string;
		compact?: boolean;
	}>(),
	{
		teleportTarget: '.window-toolbar-primary-teleport-target',
		compact: false,
	}
);

const workspacesStore = useWorkspacesStore();
const shortcutsStore = useShortcutsStore();

const teleportDisabled = computed(() => !props.teleportTarget);
const teleportTo = computed(() => props.teleportTarget || 'body');
const { openNewTabGroup, closeTabGroup, setTabs } = workspacesStore;

const previewEnabled = ref(true);
const scrollContainerRef = ref<HTMLElement | null>(null);
const plusIcon = ref('');
let scrollDisableTimeoutId: ReturnType<typeof setTimeout> | null = null;

function handleScrollActivity() {
	previewEnabled.value = false;

	if (scrollDisableTimeoutId !== null) {
		clearTimeout(scrollDisableTimeoutId);
	}

	scrollDisableTimeoutId = globalThis.setTimeout(() => {
		previewEnabled.value = true;
	}, 200);
}

function handleWheel(event: WheelEvent) {
	const container = scrollContainerRef.value;
	if (!container) return;
	container.scrollLeft += event.deltaY || event.deltaX || 0;
	handleScrollActivity();
}

function onScroll() {
	handleScrollActivity();
}

onMounted(async () => {
	plusIcon.value = await getSymbolSource('add');
});

onBeforeUnmount(() => {
	if (scrollDisableTimeoutId !== null) {
		clearTimeout(scrollDisableTimeoutId);
	}
});
</script>

<template>
  <Teleport :to="teleportTo" :disabled="teleportDisabled">
    <div class="tab-bar animate-sigma-ui-fade-in" :class="{ 'tab-bar--compact': compact }">
      <div ref="scrollContainerRef" class="tab-bar__base-container" @wheel.prevent="handleWheel" @scroll="onScroll">
        <div class="tab-bar__base">
          <TabDraggableComponent :items="workspacesStore.currentWorkspace?.tabGroups || []"
            :draggable-bg-color-var="'window-toolbar-color'" parent-selector=".tab-bar"
            @set="setTabs($event as TabGroup[])" @drag-start="previewEnabled = false" @drag-end="previewEnabled = true">
            <template #item="{ item }">
              <TabComponent :tab-group="((item as TabType[]) || [])" :preview-enabled="previewEnabled"
                @close-tab="closeTabGroup($event)" />
            </template>
          </TabDraggableComponent>
        </div>
      </div>

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="tab-bar__add-tab-button" variant="ghost" size="xs" @click="openNewTabGroup()">
            <img v-if="plusIcon" :src="plusIcon" alt="Add Tab" class="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          'tabs.newTab'
          <kbd class="shortcut">{{ shortcutsStore.getShortcutLabel('openNewTab') }}</kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  </Teleport>
</template>

<style>
.tab-bar {
  display: flex;
  max-width: 100%;
  height: 100%;
  align-items: center;
  gap: 4px;
}

.tab-bar__base-container {
  display: flex;
  overflow: auto;
  align-items: center;
  -webkit-app-region: no-drag;
  scrollbar-width: none;
}

.tab-bar__base {
  display: flex;
  width: fit-content;
  height: calc(var(--window-toolbar-height) - 4px);
  align-items: center;
  justify-content: center;
}

.tab-bar__add-tab-button {
  color: hsl(var(--muted-foreground));
}

.tab-bar--compact {
  width: 100%;
  height: 36px;
  padding: 4px 0;
}

.tab-bar--compact .tab-bar__base-container {
  overflow: auto hidden;
  min-width: 0;
  flex: 1;
}

.tab-bar--compact .tab-bar__base {
  height: 28px;
}
</style>