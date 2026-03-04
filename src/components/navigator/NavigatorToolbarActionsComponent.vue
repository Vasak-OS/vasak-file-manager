<script setup lang="ts">
import { getSymbolSource } from '@vasakgroup/plugin-vicons';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, onMounted, ref } from 'vue';
import Popover from '@/components/ui/popover/Popover.vue';
import PopoverContent from '@/components/ui/popover/PopoverContent.vue';
import PopoverTrigger from '@/components/ui/popover/PopoverTrigger.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { Layout } from '@/types/navigator';

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
  <div class="flex items-center gap-1 animate-fade-in">
      <Popover :open="isLayoutPopoverOpen" @update:open="isLayoutPopoverOpen = $event">
        <PopoverTrigger as-child>
          <Tooltip>
            <TooltipTrigger as-child>
              <button class="bg-ui-bg/80 rounded-corner p-1 flex justify-center items-center hover:bg-primary border border-ui-border">
                <img :src="layoutGridIcon" alt="Show Grid" v-if="currentLayout === 'grid'" height="24" width="24" class="fill-primary" />
                <img :src="layoutListIcon" alt="Show List" v-else height="24" width="24" class="fill-primary" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('settings.navigator.navigatorViewLayout') }}</TooltipContent>
          </Tooltip>
        </PopoverTrigger>
        <PopoverContent :side="'bottom'" :align="'end'" class="navigator-layout-popover">
          <button class="flex items-center gap-2 px-2 w-full py-1 rounded-corner hover:bg-primary"
            :class="{ 'bg-secondary hover:bg-primary': currentLayout === 'list' }" @click="setLayout('list')">
            <img :src="layoutListIcon" alt="Show List" height="24" width="24" class="fill-primary" />
            <span>{{ t('listLayout') }}</span>
          </button>
          <button class="flex items-center gap-2 px-2 py-1 rounded-corner hover:bg-primary"
            :class="{ 'bg-secondary hover:bg-primary': currentLayout === 'grid' }" @click="setLayout('grid')">
            <img :src="layoutGridIcon" alt="Show Grid" height="24" width="24" class="fill-primary" />
            <span>{{ t('gridLayout') }}</span>
          </button>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="bg-ui-bg/80 rounded-corner p-1 flex justify-center items-center hover:bg-primary border border-ui-border"
            :class="{ 'bg-primary hover:bg-secondary': props.isSplitView }"
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
            class="bg-ui-bg/80 rounded-corner p-1 flex justify-center items-center hover:bg-primary border border-ui-border"
            :class="{ 'bg-primary hover:bg-secondary': props.showInfoPanel }"
            @click="emit('toggle-info-panel')"
          >
            <img :src="infoPanelIcon" alt="Toggle Info Panel" height="24" width="24" class="fill-primary" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('settings.infoPanel.title') }}</TooltipContent>
      </Tooltip>
    </div>
</template>
