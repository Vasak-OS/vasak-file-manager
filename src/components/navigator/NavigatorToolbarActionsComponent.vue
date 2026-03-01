<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu.vue';
import DropdownMenuContent from '@/components/ui/dropdown/DropdownMenuContent.vue';
import DropdownMenuItem from '@/components/ui/dropdown/DropdownMenuItem.vue';
import DropdownMenuLabel from '@/components/ui/dropdown/DropdownMenuLabel.vue';
import DropdownMenuSeparator from '@/components/ui/dropdown/DropdownMenuSeparator.vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import PopoverTrigger from '@/components/ui/popover/PopoverTrigger.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { Layout } from '@/types/navigator';
import { getSymbolSource } from '@vasakgroup/plugin-vicons';

type LayoutType = Layout;

const { t } = useI18n();

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
	return 'list';
});
const showHiddenFiles = ref(true);
const layoutGridIcon = ref('');
const layoutListIcon = ref('');
const splitViewIcon = ref('');
const infoPanelIcon = ref('');


async function setLayout(_layoutName: LayoutType) {
	isLayoutPopoverOpen.value = false;
}

onMounted(async () => {
  layoutGridIcon.value = await getSymbolSource('view-grid');
  layoutListIcon.value = await getSymbolSource('view-list-text');
  splitViewIcon.value = await getSymbolSource('view-split-left-right');
  infoPanelIcon.value = await getSymbolSource('swap-panels');
});
</script>

<template>
  <div class="navigator-toolbar-actions animate-fade-in">
      <Popover :open="isLayoutPopoverOpen" @update:open="isLayoutPopoverOpen = $event">
        <PopoverTrigger as-child>
          <Tooltip>
            <TooltipTrigger as-child>
              <button class="background rounded-corner p-1 flex justify-center items-center hover:bg-primary">
                <img :src="layoutGridIcon" alt="Show Grid" v-if="currentLayout === 'grid'" height="24" width="24" class="fill-primary" />
                <img :src="layoutListIcon" alt="Show List" v-else height="24" width="24" class="fill-primary" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('settings.navigator.navigatorViewLayout') }}</TooltipContent>
          </Tooltip>
        </PopoverTrigger>
        <PopoverContent :side="'bottom'" :align="'end'" class="navigator-layout-popover">
          <button class="navigator-layout-option"
            :class="{ 'navigator-layout-option--active': currentLayout === 'list' }" @click="setLayout('list')">
            <img :src="layoutListIcon" alt="Show List" height="24" width="24" class="fill-primary" />
            <span>{{ t('listLayout') }}</span>
          </button>
          <button class="navigator-layout-option"
            :class="{ 'navigator-layout-option--active': currentLayout === 'grid' }" @click="setLayout('grid')">
            <img :src="layoutGridIcon" alt="Show Grid" height="24" width="24" class="fill-primary" />
            <span>{{ t('gridLayout') }}</span>
          </button>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="navigator-toolbar-actions__button"
            :class="{ 'navigator-toolbar-actions__button--active': props.isSplitView }"
            :disabled="props.isGlobalSearchOpen"
            @click="emit('toggle-split-view')"
          >
            <img :src="splitViewIcon" alt="Toggle Split View" height="24" width="24" class="fill-primary" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('splitView') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="navigator-toolbar-actions__button"
            :class="{ 'navigator-toolbar-actions__button--active': props.showInfoPanel }"
            @click="emit('toggle-info-panel')"
          >
            <img :src="infoPanelIcon" alt="Toggle Info Panel" height="24" width="24" class="fill-primary" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.infoPanel.title') }}</TooltipContent>
      </Tooltip>
    </div>
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

.navigator-toolbar-actions__button--active {
  background-color: hsl(var(--secondary));
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