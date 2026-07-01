<script setup lang="ts">
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { computed, ref, watch } from 'vue';
import { useReactiveIcon } from '@/composables/useReactiveIcon';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import type { DirEntry } from '@/types/dir-entry';
import {
  isImageFile as checkIsImage,
  isVideoFile as checkIsVideo,
  isAudioFile as checkIsAudio,
  isPdfFile as checkIsPdf,
  isTextFile as checkIsText,
} from '@/utils/files';

const props = defineProps<{
  selectedEntry: DirEntry | null;
  isCurrentDir?: boolean;
}>();

const fileIcon = useReactiveIcon(() => getIconSource('folder'));
const textContent = ref<string | null>(null);
const isTextLoading = ref(false);
const textError = ref<string | null>(null);
const pdfPreviewSrc = ref<string | null>(null);
const isPdfLoading = ref(false);
const pdfError = ref<string | null>(null);

const isImageFile = computed(() => {
  if (!props.selectedEntry) return false;
  return checkIsImage(props.selectedEntry);
});

const isVideoFile = computed(() => {
  if (!props.selectedEntry) return false;
  return checkIsVideo(props.selectedEntry);
});

const isAudioFile = computed(() => {
  if (!props.selectedEntry) return false;
  return checkIsAudio(props.selectedEntry);
});

const isPdfFile = computed(() => {
  if (!props.selectedEntry) return false;
  return checkIsPdf(props.selectedEntry);
});

const isTextFile = computed(() => {
  if (!props.selectedEntry) return false;
  return checkIsText(props.selectedEntry);
});

const mediaSrc = computed(() => {
  if (!props.selectedEntry?.path) return '';
  return convertFileSrc(props.selectedEntry.path);
});

watch(() => props.selectedEntry, async (entry) => {
  textContent.value = null;
  textError.value = null;
  pdfPreviewSrc.value = null;
  pdfError.value = null;

  if (!entry) return;

  if (checkIsText(entry)) {
    isTextLoading.value = true;
    try {
      textContent.value = await invoke<string>('read_text_file', { path: entry.path });
    } catch (e) {
      textError.value = String(e);
      textContent.value = null;
    } finally {
      isTextLoading.value = false;
    }
  }

  if (checkIsPdf(entry)) {
    isPdfLoading.value = true;
    try {
      const b64 = await invoke<string>('read_pdf_preview', { path: entry.path });
      pdfPreviewSrc.value = `data:image/png;base64,${b64}`;
    } catch (e) {
      pdfError.value = String(e);
      pdfPreviewSrc.value = null;
    } finally {
      isPdfLoading.value = false;
    }
  }
});
</script>

<template>
  <div class="flex overflow-hidden h-44 items-center justify-center rounded-corner bg-ui-surface/80">
    <div v-if="!selectedEntry" class="flex items-center justify-center">
      <img :src="fileIcon" class="h-12 w-12" />
    </div>

    <div v-else-if="isImageFile" class="flex overflow-hidden w-full h-full items-center justify-center">
      <img :src="mediaSrc" :alt="selectedEntry.name" class="h-full w-full object-cover rounded-corner" />
    </div>

    <div v-else-if="isVideoFile" class="flex overflow-hidden w-full h-full items-center justify-center">
      <video :src="mediaSrc" class="h-full w-full object-cover rounded-corner" controls preload="metadata" />
    </div>

    <div v-else-if="isAudioFile" class="flex w-full h-full items-center justify-center p-4">
      <audio :src="mediaSrc" class="w-full max-w-xs" controls preload="metadata" />
    </div>

    <div v-else-if="isPdfFile" class="flex overflow-hidden w-full h-full items-center justify-center bg-white">
      <div v-if="isPdfLoading" class="flex items-center justify-center w-full h-full text-tx-muted text-sm">
        Loading...
      </div>
      <div v-else-if="pdfError" class="flex items-center justify-center w-full h-full text-status-error text-sm p-3 text-center">
        {{ pdfError }}
      </div>
      <img v-else-if="pdfPreviewSrc" :src="pdfPreviewSrc" class="h-full w-full object-contain rounded-corner" />
    </div>

    <div v-else-if="isTextFile" class="flex overflow-auto w-full h-full p-3">
      <div v-if="isTextLoading" class="flex items-center justify-center w-full h-full text-tx-muted text-sm">
        Loading...
      </div>
      <div v-else-if="textError" class="flex items-center justify-center w-full h-full text-status-error text-sm">
        {{ textError }}
      </div>
      <pre v-else-if="textContent" class="m-0 w-full h-full text-tx-main text-[11px] leading-relaxed whitespace-pre-wrap break-all font-mono">{{ textContent }}</pre>
    </div>

    <div v-else class="flex items-center justify-center">
       <EntryIconComponent :entry="selectedEntry" class="h-12 w-12" />
    </div>
  </div>
</template>
