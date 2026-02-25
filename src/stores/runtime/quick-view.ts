import { convertFileSrc } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getAllWindows, getCurrentWindow, type Window } from '@tauri-apps/api/window';
import { defineStore } from 'pinia';
import { computed, markRaw, ref } from 'vue';
import CustomSimple from '@/components/ui/toast/CustomSimple.vue';
import { toast } from '@/components/ui/toast/toaster';
import { FILE_EXTENSIONS } from '@/constants/file-extensions';

export type QuickViewFileType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'unsupported';

export function getFileExtension(path: string): string {
	const parts = path.split('.');
	return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export function getFileName(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1] || '';
}

export function determineFileType(path: string): QuickViewFileType {
	const extension = getFileExtension(path);

	if (FILE_EXTENSIONS.IMAGE.includes(extension)) return 'image';
	if (FILE_EXTENSIONS.VIDEO.includes(extension)) return 'video';
	if (FILE_EXTENSIONS.AUDIO.includes(extension)) return 'audio';
	if (FILE_EXTENSIONS.PDF.includes(extension)) return 'pdf';
	if (FILE_EXTENSIONS.TEXT.includes(extension) || FILE_EXTENSIONS.CODE.includes(extension))
		return 'text';

	return 'unsupported';
}

export function getFileAssetUrl(path: string): string {
	if (!path) return '';
	return convertFileSrc(path);
}

export const useQuickViewStore = defineStore('quickView', () => {
	const currentFilePath = ref<string | null>(null);
	const isLoading = ref(false);
	const quickViewWindow = ref<Window | null>(null);
	const lastOpenedPath = ref<string | null>(null);

	const fileType = computed((): QuickViewFileType => {
		if (!currentFilePath.value) return 'unsupported';
		return determineFileType(currentFilePath.value);
	});

	const fileName = computed((): string => {
		if (!currentFilePath.value) return '';
		return getFileName(currentFilePath.value);
	});

	const fileAssetUrl = computed((): string => {
		if (!currentFilePath.value) return '';
		return getFileAssetUrl(currentFilePath.value);
	});

	async function getQuickViewWindow(): Promise<Window | null> {
		if (quickViewWindow.value) {
			return quickViewWindow.value;
		}

		const allWindows = await getAllWindows();
		const quickView = allWindows.find((windowItem) => windowItem.label === 'quick-view');

		if (quickView) {
			quickViewWindow.value = quickView;
		}

		return quickViewWindow.value;
	}

	function showUnsupportedFileToast(fileName: string): void {
		toast.custom(markRaw(CustomSimple), {
			componentProps: {
				title: 'notifications.quickViewFileIsNotSupported',
				description: fileName,
			},
			duration: 3000,
		});
	}

	async function openFileFromMainWindow(path: string): Promise<boolean> {
		const type = determineFileType(path);

		if (type === 'unsupported') {
			showUnsupportedFileToast(getFileName(path));
			return false;
		}

		lastOpenedPath.value = path;

		const quickWindow = await getQuickViewWindow();

		if (quickWindow) {
			const title = `Sigma File Manager | Quick View - ${getFileName(path)}`;
			await quickWindow.setTitle(title);

			await emit('quick-view:load-file', { path });

			await quickWindow.center();
			await quickWindow.show();
			await quickWindow.setFocus();
		}

		return true;
	}

	function loadFile(path: string): void {
		currentFilePath.value = path;
		isLoading.value = false;
	}

	async function closeWindow(): Promise<void> {
		const currentWindow = getCurrentWindow();

		if (currentWindow.label === 'quick-view') {
			await currentWindow.hide();
			currentFilePath.value = null;
		} else {
			const quickWindow = await getQuickViewWindow();

			if (quickWindow) {
				await quickWindow.hide();
			}

			lastOpenedPath.value = null;
		}
	}

	async function isWindowVisible(): Promise<boolean> {
		const quickWindow = await getQuickViewWindow();

		if (quickWindow) {
			return await quickWindow.isVisible();
		}

		return false;
	}

	async function toggleQuickView(path: string): Promise<boolean> {
		const isVisible = await isWindowVisible();

		if (isVisible && lastOpenedPath.value === path) {
			await closeWindow();
			return true;
		}

		return await openFileFromMainWindow(path);
	}

	return {
		currentFilePath,
		isLoading,
		fileType,
		fileName,
		fileAssetUrl,
		lastOpenedPath,
		loadFile,
		openFileFromMainWindow,
		closeWindow,
		isWindowVisible,
		toggleQuickView,
		getQuickViewWindow,
	};
});
