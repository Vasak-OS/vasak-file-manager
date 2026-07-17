<script setup lang="ts">
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { computed, ref, watch } from 'vue';
import EntryIconComponent from '@/components/icons/EntryIconComponent.vue';
import type { DirEntry } from '@/types/dir-entry';
import {
  isImageFile,
  isVideoFile,
  isAudioFile,
  isPdfFile,
  isTextFile,
} from '@/utils/files';
import { highlightCode, type HighlightedLine } from '@/utils/syntax-highlighter';

export type PreviewType = 'image' | 'text' | 'video' | 'audio' | 'pdf' | 'unsupported';

export interface FilePreviewProps {
  entry: DirEntry | null;
  mode?: 'panel' | 'modal';
}

const props = withDefaults(defineProps<FilePreviewProps>(), {
  mode: 'panel',
});

// --- State ---
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);

// Image state
const zoomLevel = ref(100);
const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
const ZOOM_STEP = 25;

// Text state
const textContent = ref<string | null>(null);
const textLineCount = ref(0);
const highlightedLines = ref<HighlightedLine[]>([]);

// Video state
const videoMetadata = ref<{ duration: string; resolution: string; codec: string } | null>(null);

// Audio state
const audioMetadata = ref<{ duration: string; bitrate: string; artist: string } | null>(null);
const audioElement = ref<HTMLAudioElement | null>(null);
const audioIsPlaying = ref(false);
const audioProgress = ref(0);
const audioDuration = ref(0);

// PDF state
const pdfPreviewSrc = ref<string | null>(null);

// Fallback metadata state
const filePermissions = ref<string | null>(null);

// --- Computed ---
const previewType = computed<PreviewType>(() => {
  if (!props.entry || props.entry.is_dir) return 'unsupported';
  if (isImageFile(props.entry)) return 'image';
  if (isTextFile(props.entry)) return 'text';
  if (isVideoFile(props.entry)) return 'video';
  if (isAudioFile(props.entry)) return 'audio';
  if (isPdfFile(props.entry)) return 'pdf';
  return 'unsupported';
});

const mediaSrc = computed(() => {
  if (!props.entry?.path) return '';
  return convertFileSrc(props.entry.path);
});

const language = computed(() => {
  if (!props.entry?.ext) return 'text';
  return extensionToLanguage(props.entry.ext.toLowerCase());
});

const formattedSize = computed(() => {
  if (!props.entry) return '';
  return formatFileSize(props.entry.size);
});

const formattedCreated = computed(() => {
  if (!props.entry) return '';
  return formatTimestamp(props.entry.created_time);
});

const formattedModified = computed(() => {
  if (!props.entry) return '';
  return formatTimestamp(props.entry.modified_time);
});

// --- Methods ---
function zoomIn() {
  zoomLevel.value = Math.min(zoomLevel.value + ZOOM_STEP, MAX_ZOOM);
}

function zoomOut() {
  zoomLevel.value = Math.max(zoomLevel.value - ZOOM_STEP, MIN_ZOOM);
}

function resetZoom() {
  zoomLevel.value = 100;
}

function handleWheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    if (event.deltaY < 0) zoomIn();
    else zoomOut();
  }
}

function toggleAudioPlayback() {
  if (!audioElement.value) return;
  if (audioIsPlaying.value) {
    audioElement.value.pause();
  } else {
    audioElement.value.play();
  }
}

function handleAudioTimeUpdate() {
  if (!audioElement.value) return;
  audioProgress.value = audioElement.value.currentTime;
}

function handleAudioLoadedMetadata() {
  if (!audioElement.value) return;
  audioDuration.value = audioElement.value.duration;
}

function handleAudioPlay() {
  audioIsPlaying.value = true;
}

function handleAudioPause() {
  audioIsPlaying.value = false;
}

function seekAudio(event: Event) {
  const target = event.target as HTMLInputElement;
  if (!audioElement.value) return;
  audioElement.value.currentTime = Number.parseFloat(target.value);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / 1024 ** i;
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTimestamp(ts: number): string {
  if (!ts) return '—';
  const date = new Date(ts * 1000);
  return date.toLocaleString();
}

function extensionToLanguage(ext: string): string {
  const map: Record<string, string> = {
    js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    vue: 'html', py: 'python', java: 'java', cpp: 'cpp', c: 'c', h: 'c',
    rs: 'rust', go: 'go', rb: 'ruby', php: 'php', swift: 'swift',
    kt: 'kotlin', cs: 'csharp', html: 'html', css: 'css',
    scss: 'css', sass: 'css', less: 'css', json: 'json', xml: 'xml',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
    sh: 'bash', bash: 'bash', ps1: 'powershell', sql: 'sql',
    txt: 'text', log: 'text', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'text',
  };
  return map[ext] || 'text';
}

function tokenClass(type: string): string {
  switch (type) {
    case 'keyword': return 'text-purple-400';
    case 'string': return 'text-green-400';
    case 'comment': return 'text-tx-muted italic';
    case 'number': return 'text-orange-400';
    default: return 'text-tx-main';
  }
}

// --- Watcher ---
watch(
  () => props.entry,
  async (entry) => {
    // Reset state
    errorMessage.value = null;
    textContent.value = null;
    textLineCount.value = 0;
    highlightedLines.value = [];
    videoMetadata.value = null;
    audioMetadata.value = null;
    pdfPreviewSrc.value = null;
    filePermissions.value = null;
    zoomLevel.value = 100;
    audioIsPlaying.value = false;
    audioProgress.value = 0;
    audioDuration.value = 0;

    if (!entry || entry.is_dir) return;

    const type = previewType.value;
    isLoading.value = true;

    try {
      if (type === 'text') {
        await loadTextPreview(entry.path);
      } else if (type === 'pdf') {
        await loadPdfPreview(entry.path);
      } else if (type === 'video') {
        loadVideoMetadata();
      } else if (type === 'audio') {
        loadAudioMetadata();
      } else if (type === 'unsupported') {
        await loadFilePermissions(entry.path);
      }
    } catch (e) {
      errorMessage.value = String(e);
    } finally {
      isLoading.value = false;
    }
  },
  { immediate: true }
);

async function loadTextPreview(path: string) {
  try {
    const content = await invoke<string>('read_text_file', { path });
    // Limit to 500 lines
    const lines = content.split('\n');
    const limitedLines = lines.slice(0, 500);
    textLineCount.value = Math.min(lines.length, 500);
    textContent.value = limitedLines.join('\n');
    // Compute syntax highlighting
    highlightedLines.value = highlightCode(textContent.value, language.value);
  } catch (e) {
    errorMessage.value = String(e);
    textContent.value = null;
    highlightedLines.value = [];
  }
}

async function loadPdfPreview(path: string) {
  try {
    const b64 = await invoke<string>('read_pdf_preview', { path });
    pdfPreviewSrc.value = `data:image/png;base64,${b64}`;
  } catch (e) {
    errorMessage.value = String(e);
    pdfPreviewSrc.value = null;
  }
}

function loadVideoMetadata() {
  // Video metadata is loaded from the <video> element events
  videoMetadata.value = null;
}

function handleVideoLoadedMetadata(event: Event) {
  const video = event.target as HTMLVideoElement;
  videoMetadata.value = {
    duration: formatDuration(video.duration),
    resolution: `${video.videoWidth}×${video.videoHeight}`,
    codec: getVideoCodecFromExtension(props.entry?.ext || ''),
  };
  isLoading.value = false;
}

function loadAudioMetadata() {
  // Audio metadata is loaded from the <audio> element events
  audioMetadata.value = null;
}

async function loadFilePermissions(path: string) {
  try {
    const perms = await invoke<string>('get_file_permissions', { path });
    filePermissions.value = perms;
  } catch {
    filePermissions.value = null;
  }
}

function handleAudioFullMetadata() {
  if (!audioElement.value) return;
  audioMetadata.value = {
    duration: formatDuration(audioElement.value.duration),
    bitrate: estimateBitrate(props.entry?.size || 0, audioElement.value.duration),
    artist: '—',
  };
  isLoading.value = false;
}

function estimateBitrate(fileSize: number, duration: number): string {
  if (!duration || duration <= 0) return '—';
  const bitsPerSecond = (fileSize * 8) / duration;
  const kbps = Math.round(bitsPerSecond / 1000);
  return `${kbps} kbps`;
}

function getVideoCodecFromExtension(ext: string): string {
  const codecMap: Record<string, string> = {
    mp4: 'H.264/AVC', mkv: 'Variable', avi: 'Variable', mov: 'H.264/ProRes',
    wmv: 'WMV', flv: 'FLV', webm: 'VP8/VP9', m4v: 'H.264',
    mpeg: 'MPEG-2', mpg: 'MPEG-1/2',
  };
  return codecMap[ext.toLowerCase()] || 'Unknown';
}
</script>

<template>
  <div
    class="flex flex-col w-full h-full overflow-hidden rounded-corner bg-ui-surface/80"
    :class="{ 'fixed inset-0 z-50 bg-ui-bg/95': mode === 'modal' }"
  >
    <!-- Loading State -->
    <div v-if="isLoading" class="flex items-center justify-center w-full h-full text-tx-muted text-sm">
      <div class="flex flex-col items-center gap-2">
        <div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span>Loading preview...</span>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="errorMessage" class="flex items-center justify-center w-full h-full p-4">
      <div class="text-center text-status-error text-sm">
        <p class="font-medium">Unable to preview file</p>
        <p class="mt-1 text-tx-muted text-xs">{{ errorMessage }}</p>
      </div>
    </div>

    <!-- No entry selected -->
    <div v-else-if="!entry" class="flex items-center justify-center w-full h-full text-tx-muted text-sm">
      No file selected
    </div>

    <!-- Image Preview -->
    <div
      v-else-if="previewType === 'image'"
      class="flex flex-col w-full h-full"
      @wheel="handleWheel"
    >
      <div class="flex-1 overflow-auto flex items-center justify-center p-2">
        <img
          :src="mediaSrc"
          :alt="entry.name"
          class="max-w-full max-h-full object-contain transition-transform duration-150"
          :style="{ transform: `scale(${zoomLevel / 100})` }"
        />
      </div>
      <!-- Zoom Controls -->
      <div class="flex items-center justify-center gap-2 p-2 border-t border-ui-border bg-ui-bg/60">
        <button
          class="px-2 py-0.5 text-xs rounded bg-ui-surface hover:bg-primary/20 text-tx-main disabled:opacity-40"
          :disabled="zoomLevel <= MIN_ZOOM"
          @click="zoomOut"
          title="Zoom out"
        >
          −
        </button>
        <button
          class="px-2 py-0.5 text-xs rounded bg-ui-surface hover:bg-primary/20 text-tx-main"
          @click="resetZoom"
          title="Reset zoom"
        >
          {{ zoomLevel }}%
        </button>
        <button
          class="px-2 py-0.5 text-xs rounded bg-ui-surface hover:bg-primary/20 text-tx-main disabled:opacity-40"
          :disabled="zoomLevel >= MAX_ZOOM"
          @click="zoomIn"
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>

    <!-- Text/Code Preview -->
    <div v-else-if="previewType === 'text'" class="flex flex-col w-full h-full overflow-hidden">
      <div class="flex items-center justify-between px-3 py-1.5 border-b border-ui-border bg-ui-bg/60">
        <span class="text-xs text-tx-muted font-mono">{{ language }}</span>
        <span class="text-xs text-tx-muted">{{ textLineCount }} lines</span>
      </div>
      <div class="flex-1 overflow-auto">
        <table v-if="highlightedLines.length > 0" class="w-full border-collapse font-mono text-[11px] leading-relaxed">
          <tbody>
            <tr v-for="(line, lineIdx) in highlightedLines" :key="lineIdx">
              <td class="select-none text-right pr-3 pl-3 text-tx-muted/50 align-top w-[1%] whitespace-nowrap">{{ lineIdx + 1 }}</td>
              <td class="pr-3 whitespace-pre-wrap break-all"><template v-for="(token, tIdx) in line.tokens" :key="tIdx"><span :class="tokenClass(token.type)">{{ token.text }}</span></template></td>
            </tr>
          </tbody>
        </table>
        <table v-else-if="textContent" class="w-full border-collapse font-mono text-[11px] leading-relaxed">
          <tbody>
            <tr v-for="(line, lineIdx) in textContent.split('\n')" :key="lineIdx">
              <td class="select-none text-right pr-3 pl-3 text-tx-muted/50 align-top w-[1%] whitespace-nowrap">{{ lineIdx + 1 }}</td>
              <td class="pr-3 whitespace-pre-wrap break-all text-tx-main">{{ line }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Video Preview -->
    <div v-else-if="previewType === 'video'" class="flex flex-col w-full h-full">
      <div class="flex-1 overflow-hidden flex items-center justify-center bg-black/5">
        <video
          :src="mediaSrc"
          class="max-w-full max-h-full object-contain"
          preload="metadata"
          :aria-label="`Video preview: ${entry?.name}`"
          @loadedmetadata="handleVideoLoadedMetadata"
        >
          <track kind="descriptions" :label="entry?.name || 'Video'" />
        </video>
      </div>
      <!-- Video Metadata -->
      <div v-if="videoMetadata" class="flex flex-col gap-1 p-3 border-t border-ui-border bg-ui-bg/60">
        <div class="grid grid-cols-3 gap-2 text-xs">
          <div class="flex flex-col">
            <span class="text-tx-muted">Duration</span>
            <span class="text-tx-main font-medium">{{ videoMetadata.duration }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-tx-muted">Resolution</span>
            <span class="text-tx-main font-medium">{{ videoMetadata.resolution }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-tx-muted">Codec</span>
            <span class="text-tx-main font-medium">{{ videoMetadata.codec }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Audio Preview -->
    <div v-else-if="previewType === 'audio'" class="flex flex-col w-full h-full">
      <!-- Audio metadata -->
      <div v-if="audioMetadata" class="flex-1 flex flex-col items-center justify-center gap-4 p-4">
        <EntryIconComponent v-if="entry" :entry="entry" class="w-16 h-16 opacity-60" />
        <div class="grid grid-cols-3 gap-3 w-full text-xs text-center">
          <div class="flex flex-col">
            <span class="text-tx-muted">Duration</span>
            <span class="text-tx-main font-medium">{{ audioMetadata.duration }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-tx-muted">Bitrate</span>
            <span class="text-tx-main font-medium">{{ audioMetadata.bitrate }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-tx-muted">Artist</span>
            <span class="text-tx-main font-medium">{{ audioMetadata.artist }}</span>
          </div>
        </div>
      </div>
      <div v-else class="flex-1 flex items-center justify-center">
        <EntryIconComponent v-if="entry" :entry="entry" class="w-16 h-16 opacity-60" />
      </div>

      <!-- Audio Player Controls -->
      <div class="flex flex-col gap-2 p-3 border-t border-ui-border bg-ui-bg/60">
        <audio
          ref="audioElement"
          :src="mediaSrc"
          preload="metadata"
          @timeupdate="handleAudioTimeUpdate"
          @loadedmetadata="handleAudioLoadedMetadata"
          @canplay="handleAudioFullMetadata"
          @play="handleAudioPlay"
          @pause="handleAudioPause"
        />
        <!-- Progress bar -->
        <label for="audio-progress-slider" class="sr-only">Audio progress</label>
        <input
          id="audio-progress-slider"
          type="range"
          min="0"
          :max="audioDuration || 0"
          :value="audioProgress"
          step="0.1"
          class="w-full h-1 bg-ui-surface rounded-full appearance-none cursor-pointer accent-primary"
          @input="seekAudio"
        />
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-tx-muted">{{ formatDuration(audioProgress) }}</span>
          <!-- Play/Pause button -->
          <button
            class="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 hover:bg-primary/30 text-primary transition-colors"
            @click="toggleAudioPlayback"
            :title="audioIsPlaying ? 'Pause' : 'Play'"
          >
            <svg v-if="!audioIsPlaying" class="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          </button>
          <span class="text-[10px] text-tx-muted">{{ formatDuration(audioDuration) }}</span>
        </div>
      </div>
    </div>

    <!-- PDF Preview -->
    <div v-else-if="previewType === 'pdf'" class="flex items-center justify-center w-full h-full bg-white/5 p-2">
      <img
        v-if="pdfPreviewSrc"
        :src="pdfPreviewSrc"
        :alt="`PDF preview: ${entry?.name}`"
        class="max-w-full max-h-full object-contain rounded"
      />
      <div v-else class="text-tx-muted text-sm">Unable to render PDF</div>
    </div>

    <!-- Fallback: Metadata display -->
    <div v-else class="flex flex-col w-full h-full p-4">
      <div class="flex-1 flex flex-col items-center justify-center gap-3">
        <EntryIconComponent v-if="entry" :entry="entry" class="w-16 h-16 opacity-60" />
        <span class="text-sm text-tx-main font-medium text-center break-all">{{ entry?.name }}</span>
      </div>
      <div class="flex flex-col gap-2 p-3 border-t border-ui-border text-xs">
        <div class="flex justify-between">
          <span class="text-tx-muted">Size</span>
          <span class="text-tx-main">{{ formattedSize }}</span>
        </div>
        <div v-if="filePermissions" class="flex justify-between">
          <span class="text-tx-muted">Permissions</span>
          <span class="text-tx-main font-mono">{{ filePermissions }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-tx-muted">Created</span>
          <span class="text-tx-main">{{ formattedCreated }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-tx-muted">Modified</span>
          <span class="text-tx-main">{{ formattedModified }}</span>
        </div>
        <div v-if="entry?.mime" class="flex justify-between">
          <span class="text-tx-muted">Type</span>
          <span class="text-tx-main">{{ entry.mime }}</span>
        </div>
        <div v-if="entry?.ext" class="flex justify-between">
          <span class="text-tx-muted">Extension</span>
          <span class="text-tx-main">.{{ entry.ext }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
