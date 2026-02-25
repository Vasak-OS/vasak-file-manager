<script setup lang="ts">
import { computed, ref } from 'vue';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu.vue';
import DropdownMenuContent from '@/components/ui/dropdown/DropdownMenuContent.vue';
import DropdownMenuItem from '@/components/ui/dropdown/DropdownMenuItem.vue';
import DropdownMenuLabel from '@/components/ui/dropdown/DropdownMenuLabel.vue';
import DropdownMenuSeparator from '@/components/ui/dropdown/DropdownMenuSeparator.vue';
import DropdownMenuTrigger from '@/components/ui/dropdown/DropdownMenuTrigger.vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import PopoverTrigger from '@/components/ui/popover/PopoverTrigger.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { Layout } from '@/types/navigator';

type LayoutType = Layout;

const props = defineProps<{
	isSplitView: boolean;
	showInfoPanel: boolean;
	isGlobalSearchOpen: boolean;
}>();

const emit = defineEmits<{
	'toggle-split-view': [];
	'toggle-info-panel': [];
}>();

const isLayoutPopoverOpen = ref(false);

const currentLayout = computed(() => {
	// const layoutName = 'list';
	// switch (layoutName) {
	// 	case LAYOUTS_TYPES.list:
	// 		return 'list';
	// 	case LAYOUTS_TYPES.compactList:
	// 		return 'compact-list';
	// 	case LAYOUTS_TYPES.grid:
	// 		return 'grid';
	// 	default:
	// 		return 'list';
	// }
	return 'list';
});

const showHiddenFiles = ref(true);

async function setLayout(layoutName: LayoutType) {
	const layoutTitle = layoutName === 'grid' ? 'gridLayout' : 'listLayout';
	// await userSettingsStore.set('navigator.layout.type', {
	//   title: layoutTitle,
	//   name: layoutName,
	// });
	isLayoutPopoverOpen.value = false;
}
</script>

<template>
  <Teleport to=".window-toolbar-secondary-teleport-target">
    <div class="navigator-toolbar-actions animate-fade-in">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger as-child>
            <DropdownMenuTrigger as-child>
              <button class="navigator-toolbar-actions__button">
                <EllipsisVerticalIcon :size="16" class="navigator-toolbar-actions__icon" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <DropdownMenuContent :side="'bottom'" :align="'end'" class="navigator-settings-menu">
            <DropdownMenuLabel>'settings.navigator.navigatorOptions'</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="navigator-settings-menu__item" @select.prevent>
              <span class="navigator-settings-menu__item-label">'filter.showHiddenItems'</span>
              <input
                type="checkbox"
                class="navigator-settings-menu__switch"
                :checked="showHiddenFiles"
                @change="showHiddenFiles = !showHiddenFiles"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
          <TooltipContent>
            'settings.navigator.navigatorOptions'
          </TooltipContent>
        </Tooltip>
      </DropdownMenu>

      <Popover :open="isLayoutPopoverOpen" @update:open="isLayoutPopoverOpen = $event">
        <Tooltip>
          <TooltipTrigger as-child>
            <PopoverTrigger as-child>
              <button class="navigator-toolbar-actions__button">
                <LayoutGridIcon v-if="currentLayout === 'grid'" :size="16" class="navigator-toolbar-actions__icon" />
                <ListIcon v-else :size="16" class="navigator-toolbar-actions__icon" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <PopoverContent :side="'bottom'" :align="'end'" class="navigator-layout-popover">
            <button class="navigator-layout-option"
              :class="{ 'navigator-layout-option--active': currentLayout === 'list' }" @click="setLayout('list')">
              <ListIcon :size="16" />
              <span>'listLayout'</span>
            </button>
            <button class="navigator-layout-option"
              :class="{ 'navigator-layout-option--active': currentLayout === 'grid' }" @click="setLayout('grid')">
              <LayoutGridIcon :size="16" />
              <span>'gridLayout'</span>
            </button>
          </PopoverContent>
          <TooltipContent>
            'settings.navigator.navigatorViewLayout'
          </TooltipContent>
        </Tooltip>
      </Popover>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="navigator-toolbar-actions__button"
            :class="{ 'navigator-toolbar-actions__button--active': props.isSplitView }"
            :disabled="props.isGlobalSearchOpen"
            @click="emit('toggle-split-view')"
          >
            <FlipHorizontalIcon :size="16" class="navigator-toolbar-actions__icon" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          'splitView'
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="navigator-toolbar-actions__button"
            :class="{ 'navigator-toolbar-actions__button--active': props.showInfoPanel }"
            @click="emit('toggle-info-panel')"
          >
            <PanelRightIcon :size="16" class="navigator-toolbar-actions__icon" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          'settings.infoPanel.title'
        </TooltipContent>
      </Tooltip>
    </div>
  </Teleport>
</template>

<style>
.navigator-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.navigator-toolbar-actions__button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: hsl(var(--foreground));
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.navigator-toolbar-actions__button:hover {
  background-color: hsl(var(--muted));
}

.navigator-toolbar-actions__button:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

.navigator-toolbar-actions__button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.navigator-toolbar-actions__icon {
  stroke: hsl(var(--icon));
}

.navigator-toolbar-actions__button--active {
  background-color: hsl(var(--secondary));
}

.navigator-toolbar-actions__button--active .navigator-toolbar-actions__icon {
  stroke: hsl(var(--primary));
}

.navigator-layout-popover.sigma-ui-popover-content {
  display: flex;
  width: auto;
  flex-direction: column;
  padding: 4px;
  gap: 2px;
}

.navigator-layout-option {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: hsl(var(--foreground));
  cursor: pointer;
  font-size: 13px;
  gap: 8px;
  transition: background-color 0.15s;
}

.navigator-layout-option:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

.navigator-layout-option:hover {
  background-color: hsl(var(--secondary));
}

.navigator-layout-option--active {
  background-color: hsl(var(--primary) / 15%);
  color: hsl(var(--primary));
}

.navigator-layout-option--active:hover {
  background-color: hsl(var(--primary) / 25%);
}

.navigator-settings-menu.sigma-ui-dropdown-menu-content {
  min-width: 200px;
}

.navigator-settings-menu__item.sigma-ui-dropdown-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: default;
  gap: 12px;
}

.navigator-settings-menu__item.sigma-ui-dropdown-menu-item:focus,
.navigator-settings-menu__item.sigma-ui-dropdown-menu-item:hover {
  background-color: transparent;
  color: inherit;
}

.navigator-settings-menu__item-label {
  flex: 1;
}

.navigator-settings-menu__switch {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: hsl(var(--primary));
}
</style>