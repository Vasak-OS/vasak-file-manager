<script lang="ts" setup>
import { ref, Ref, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getIconSource } from "@vasakgroup/plugin-vicons";

const appWindow = getCurrentWindow();
const closeIcon: Ref<string> = ref("");
const minimizeIcon: Ref<string> = ref("");
const maximizeIcon: Ref<string> = ref("");

onMounted(async () => {
  closeIcon.value = await getIconSource("window-close");
  minimizeIcon.value = await getIconSource("window-minimize");
  maximizeIcon.value = await getIconSource("window-maximize");
});
</script>
<template>
  <div class="flex gap-1" data-tauri-drag-region>
    <span class="p-1 background rounded-corner hover:bg-status-success dark:hover:bg-status-success-dark" @click="appWindow.minimize()">
      <img :src="minimizeIcon" class="h-6 w-6 inline-block" alt="Minimize">
    </span>
    <span class="p-1 background rounded-corner hover:bg-status-warning dark:hover:bg-status-warning-dark" @click="appWindow.toggleMaximize()">
      <img :src="maximizeIcon" class="h-6 w-6 inline-block" alt="Maximize">
    </span>
    <span class="p-1 background rounded-corner hover:bg-status-error dark:hover:bg-status-error-dark" @click="appWindow.close()">
      <img :src="closeIcon" class="h-6 w-6 inline-block" alt="Close">
    </span>
  </div>
</template>