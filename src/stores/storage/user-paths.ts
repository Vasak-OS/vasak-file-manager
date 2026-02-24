import { defineStore } from 'pinia';
import { ref } from 'vue';
import { userPathsFunctions } from '@/data/user-paths';
import type { CustomPaths, UserPaths, UserPathsFunctions } from '@/data/user-paths';

export const useUserPathsStore = defineStore('userPaths', () => {
  const userPaths = ref<UserPaths>({
    appCacheDir: '',
    appConfigDir: '',
    appDataDir: '',
    appLocalDataDir: '',
    appLogDir: '',
    audioDir: '',
    cacheDir: '',
    configDir: '',
    dataDir: '',
    desktopDir: '',
    documentDir: '',
    downloadDir: '',
    executableDir: '',
    fontDir: '',
    homeDir: '',
    localDataDir: '',
    pictureDir: '',
    publicDir: '',
    resourceDir: '',
    runtimeDir: '',
    templateDir: '',
    videoDir: '',
  });

  const customPaths = ref<CustomPaths>({
    appUserDataDir: '',
    appUserDataSettingsName: '',
    appUserDataSettingsPath: '',
    appUserDataWorkspacesName: '',
    appUserDataWorkspacesPath: '',
    appUserDataStatsName: '',
    appUserDataStatsPath: '',
    appStorageHomeBannerMediaPath: '',
  });

  const platformSpecificPaths = new Set(['runtimeDir', 'fontDir', 'executableDir', 'templateDir']);

  async function init() {
    try {
      const promises = Object.keys(userPathsFunctions).map(async (key) => {
        try {
          const resolvedPath = await userPathsFunctions[key as keyof UserPathsFunctions]();
          userPaths.value[key as keyof UserPaths] = resolvedPath;
        }
        catch (error) {
          if (!platformSpecificPaths.has(key)) {
            console.warn(`Failed to resolve path for ${key}`, error);
          }

          userPaths.value[key as keyof UserPaths] = '';
        }
      });
      await Promise.allSettled(promises);
      setCustomPaths();
    }
    catch (error) {
      console.error('Failed to initialize user paths:', error);
    }
  }

  function setCustomPaths() {
    customPaths.value.appUserDataDir = `${userPaths.value.appDataDir}/user-data`;
    customPaths.value.appUserDataSettingsName = 'user-settings.json';
    customPaths.value.appUserDataSettingsPath = `${customPaths.value.appUserDataDir}/${customPaths.value.appUserDataSettingsName}`;
    customPaths.value.appUserDataWorkspacesName = 'workspaces.json';
    customPaths.value.appUserDataWorkspacesPath = `${customPaths.value.appUserDataDir}/${customPaths.value.appUserDataWorkspacesName}`;
    customPaths.value.appUserDataStatsName = 'user-stats.json';
    customPaths.value.appUserDataStatsPath = `${customPaths.value.appUserDataDir}/${customPaths.value.appUserDataStatsName}`;
    customPaths.value.appStorageHomeBannerMediaPath = `${customPaths.value.appUserDataDir}/media/home-banner`;
  }

  return {
    userPaths,
    customPaths,
    init,
  };
});