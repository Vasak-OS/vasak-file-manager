<script lang="ts" setup>
import SidebarComponent from '@/components/sidebar/SidebarComponent.vue';
import ContentInformation from '../components/content/ContentInformation.vue';
import TopBarComponent from '../components/topbar/TopBarComponent.vue';
</script>
<template>
  <div class="h-screen w-screen background rounded-corner-window flex">
    <SidebarComponent />
    <div class="flex-1 flex flex-col">
      <TopBarComponent />
      <div class="flex-1 flex p-1">
        <div class="flex-1">
          <slot />
        </div>
        <ContentInformation />
      </div>
    </div>
  </div>
</template>
