<script lang="ts" setup>
import SidebarComponent from "@/components/sidebar/SidebarComponent.vue"
import TopBarComponent from "../components/topbar/TopBarComponent.vue";
</script>
<template>
  <div class="h-screen w-screen background rounded-corner-window flex">
    <SidebarComponent />
    <div class="flex-1 flex flex-col">
      <TopBarComponent />
      <slot />
    </div>
  </div>
</template>
