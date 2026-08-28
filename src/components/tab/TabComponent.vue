<script setup lang="ts">
import { getSymbolSource } from '@vasakgroup/plugin-vicons';
import { useContextMenu } from '@vasakgroup/plugin-vsk-contextual-menu';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, ref } from 'vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
import { useReactiveIcon } from '@/composables/useReactiveIcon';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { Tab } from '@/types/workspaces';
import { useEventListener } from '@/utils/event-listener';
import { useTimeoutFn } from '@/utils/timeout';

interface Props {
	tabGroup: Tab[];
	previewEnabled: boolean;
}

type Emits = (event: 'close-tab', value: Tab[]) => void;

const props = withDefaults(defineProps<Props>(), {
	tabGroup: () => [],
});
const emit = defineEmits<Emits>();
const { t } = useI18n();

const workspacesStore = useWorkspacesStore();
const { show: showTabMenu } = useContextMenu();
const xIcon = useReactiveIcon(() => getSymbolSource('gtk-close'));
const showTabPreview = true;
const LONG_PRESS_DELAY = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10;

const isMenuOpen = ref(false);
const isLongPressing = ref(false);
const isPressing = ref(false);
const startPosition = ref({
	x: 0,
	y: 0,
});

const { start: startLongPressTimer, stop: stopLongPressTimer } = useTimeoutFn(
	() => {
		isLongPressing.value = true;
		abrirMenuDePestana(startPosition.value);
	},
	LONG_PRESS_DELAY,
	{ immediate: false }
);

useEventListener(document, 'pointermove', (event: PointerEvent) => {
	if (!isPressing.value) return;

	const deltaX = Math.abs(event.clientX - startPosition.value.x);
	const deltaY = Math.abs(event.clientY - startPosition.value.y);
	const distance = Math.hypot(deltaX, deltaY);

	if (distance > LONG_PRESS_MOVE_THRESHOLD) {
		stopLongPressTimer();
	}
});

useEventListener(document, 'pointerup', () => {
	isPressing.value = false;
	stopLongPressTimer();
});

useEventListener(document, 'pointercancel', () => {
	isPressing.value = false;
	stopLongPressTimer();
});

function handlePointerDown(event: PointerEvent) {
	if (event.pointerType !== 'touch') return;

	isPressing.value = true;
	startPosition.value = {
		x: event.clientX,
		y: event.clientY,
	};
	startLongPressTimer();
}

const isActive = computed(() => {
	const currentIndex = workspacesStore.currentWorkspace?.currentTabGroupIndex;
	const tabGroupIndex = workspacesStore.currentWorkspace?.tabGroups.findIndex(
		(tg) => tg[0]?.id === props.tabGroup?.[0]?.id
	);
	return currentIndex === tabGroupIndex && tabGroupIndex !== -1;
});

const showCloseButton = computed(() => {
	const tabGroups = workspacesStore.currentWorkspace?.tabGroups ?? [];
	return tabGroups.length > 1;
});

const tabName = computed(() => {
	const firstTab = props.tabGroup?.[0];
	const secondTab = props.tabGroup?.[1];

	if (!firstTab) {
		return '';
	}

	if (props.tabGroup?.length === 2 && secondTab) {
		return `${firstTab.name || firstTab.path} | ${secondTab.name || secondTab.path}`;
	}

	return `${firstTab.name || firstTab.path}`;
});

function tabOnClick(tabGroup: Tab[]) {
	if (isLongPressing.value) {
		isLongPressing.value = false;
		return;
	}

	workspacesStore.openTabGroup(tabGroup);
}

/**
 * El menú de la pestaña, el mismo que dibuja el resto del escritorio.
 *
 * Lo abren dos gestos: el clic derecho y el toque sostenido, que en una pantalla
 * táctil es lo mismo. Por eso recibe un punto y no un evento.
 */
async function openTabMenu(punto: { x: number; y: number }) {
	isMenuOpen.value = true;

	// La bandera sólo existe para callar la vista previa mientras el menú tapa la
	// pestaña. Si abrirlo falla, sin el `finally` se quedaría prendida para
	// siempre y esa pestaña nunca volvería a mostrar su vista previa.
	try {
		const elegido = await showTabMenu(
			[
				{ id: 'cerrar-otras', label: t('tabs.closeOtherTabs'), icon: 'gtk-close' },
				{ id: 'cerrar-todas', label: t('tabs.closeAllTabs'), icon: 'gtk-close' },
			],
			punto
		);

		if (elegido?.id === 'cerrar-otras') await closeOtherTabs();
		if (elegido?.id === 'cerrar-todas') await closeAllTabs();
	} finally {
		isMenuOpen.value = false;
	}
}

/** Abrir el menú no puede tumbar nada: lo peor que pasa es que no aparezca. */
function abrirMenuDePestana(punto: { x: number; y: number }) {
	openTabMenu(punto).catch((error) => {
		console.warn('No se pudo abrir el menú de la pestaña:', error);
	});
}

function handleContextMenu(event: MouseEvent) {
	abrirMenuDePestana({ x: event.clientX, y: event.clientY });
}

function handleAuxClick(event: MouseEvent) {
	if (event.button === 1) {
		event.preventDefault();
		emit('close-tab', props.tabGroup);
	}
}

async function closeOtherTabs() {
	await workspacesStore.closeOtherTabGroups(props.tabGroup);
}

async function closeAllTabs() {
	await workspacesStore.closeAllTabGroups();
}
</script>

<template>
    <Tooltip :disabled="!(props.previewEnabled && showTabPreview) || isMenuOpen"
      :key="props.previewEnabled && showTabPreview ? 'enabled' : 'disabled'">
      <TooltipTrigger as-child>
          <div v-if="props.tabGroup?.length" v-wave class="relative flex w-34 max-w-34 rounded-corner p-1 px-3 pr-3 items-center border border-ui-border" :class="{ 'bg-primary text-tx-on-primary font-bold': isActive, 'bg-ui-bg/80': !isActive }"
            @click.stop="tabOnClick(props.tabGroup)" @auxclick.stop="handleAuxClick"
            @contextmenu="handleContextMenu" @pointerdown="handlePointerDown">
            <div class="w-full overflow-hidden">
              <span class="overflow-hidden text-ellipsis whitespace-nowrap" :title="tabName">
                {{ tabName }}
              </span>
            </div>

            <button v-if="showCloseButton"
              @click.stop="emit('close-tab', props.tabGroup)" :aria-label="t('tabs.close')">
              <img :src="xIcon" :alt="t('tabs.close')" class="h-6 w-6" />
            </button>
          </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" class="min-w-50 max-w-100 bg-ui-bg/80 rounded-corner p-2">
        <span>
          <div v-for="(tab, index) in props.tabGroup" :key="index">
            <div class="overflow-hidden text-ellipsis whitespace-nowrap text-primary text-base" :title="tab.name || tab.path">
              {{ tab.name }}
            </div>
            <div class="overflow-hidden text-ellipsis whitespace-nowrap text-secondary text-sm" :title="tab.path">
              {{ tab.path }}
            </div>
          </div>
        </span>
      </TooltipContent>
    </Tooltip>
</template>
