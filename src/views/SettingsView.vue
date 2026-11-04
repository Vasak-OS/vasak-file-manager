<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	ConfigSection,
	SegmentedControl,
	type SegmentedOption,
	SettingRow,
	SwitchRow,
	ThemeIcon,
} from '@vasakgroup/vue-libvasak';
import { computed } from 'vue';
import { type TextSize, useUserSettingsStore } from '@/stores/storage/user-settings';

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const settingsStore = useUserSettingsStore();

const textSizeOptions = computed<SegmentedOption<TextSize>[]>(() => [
	{ value: 'small', label: t('settings.appearance.textSizeSmall') },
	{ value: 'medium', label: t('settings.appearance.textSizeMedium') },
	{ value: 'large', label: t('settings.appearance.textSizeLarge') },
]);

function setTextSize(value: TextSize | null) {
	if (value) settingsStore.update({ textSize: value });
}
</script>

<template>
  <div class="flex h-full flex-col rounded-corner-l border border-ui-line">
    <div class="flex min-w-0 items-center gap-2 p-2">
      <ThemeIcon name="preferences-system" type="symbol" :size="20" />
      <span class="min-w-0 flex-1 truncate text-body-m font-medium text-tx-main">
        {{ t('settings.title') }}
      </span>
      <ActionButton :label="''" :icon-alt="t('settings.close')" :title="t('settings.close')"
        icon="window-close" variant="ghost" @click="emit('close')" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <ConfigSection :title="t('settings.appearance.title')" icon="preferences-desktop-theme" icon-type="symbol">
        <SwitchRow
          :model-value="settingsStore.reduceMotion"
          :label="t('settings.appearance.reduceMotion')"
          :description="t('settings.appearance.reduceMotionDesc')"
          @update:model-value="settingsStore.update({ reduceMotion: $event })" />
        <SwitchRow
          :model-value="settingsStore.lowPower"
          :label="t('settings.appearance.lowPower')"
          :description="t('settings.appearance.lowPowerDesc')"
          @update:model-value="settingsStore.update({ lowPower: $event })" />
        <SettingRow
          :label="t('settings.appearance.textSize')"
          :description="t('settings.appearance.textSizeDesc')">
          <SegmentedControl
            :model-value="settingsStore.textSize"
            :options="textSizeOptions"
            :label="t('settings.appearance.textSize')"
            @update:model-value="setTextSize" />
        </SettingRow>
      </ConfigSection>
    </div>
  </div>
</template>
