import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useBookmarksStore } from './bookmarks';

// Mock @tauri-apps/plugin-store
vi.mock('@tauri-apps/plugin-store', () => ({
	LazyStore: vi.fn().mockImplementation(() => ({
		save: vi.fn(),
		entries: vi.fn().mockResolvedValue([]),
		set: vi.fn(),
	})),
}));

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn().mockResolvedValue(true),
}));

// Mock @vasakgroup/tauri-plugin-i18n
vi.mock('@vasakgroup/tauri-plugin-i18n', () => ({
	useI18n: () => ({ t: (key: string) => key }),
}));

// Mock localStorage
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		},
	};
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('bookmarks store', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		localStorageMock.clear();
	});

	it('should start with empty favorites', () => {
		const store = useBookmarksStore();
		expect(store.favorites).toEqual([]);
	});

	it('should add a favorite', () => {
		const store = useBookmarksStore();
		store.addFavorite('/home/user/Documents');
		expect(store.favorites).toHaveLength(1);
		expect(store.favorites[0].path).toBe('/home/user/Documents');
		expect(store.favorites[0].name).toBe('Documents');
		expect(store.favorites[0].exists).toBe(true);
	});

	it('should not add duplicate favorites', () => {
		const store = useBookmarksStore();
		store.addFavorite('/home/user/Documents');
		store.addFavorite('/home/user/Documents');
		expect(store.favorites).toHaveLength(1);
	});

	it('should remove a favorite', () => {
		const store = useBookmarksStore();
		store.addFavorite('/home/user/Documents');
		store.addFavorite('/home/user/Downloads');
		store.removeFavorite('/home/user/Documents');
		expect(store.favorites).toHaveLength(1);
		expect(store.favorites[0].path).toBe('/home/user/Downloads');
	});

	it('should reorder favorites', () => {
		const store = useBookmarksStore();
		store.addFavorite('/a');
		store.addFavorite('/b');
		store.addFavorite('/c');

		store.reorderFavorite(2, 0);
		expect(store.favoritePaths).toEqual(['/c', '/a', '/b']);
	});

	it('should not reorder with invalid indices', () => {
		const store = useBookmarksStore();
		store.addFavorite('/a');
		store.addFavorite('/b');

		store.reorderFavorite(-1, 0);
		expect(store.favoritePaths).toEqual(['/a', '/b']);

		store.reorderFavorite(0, 5);
		expect(store.favoritePaths).toEqual(['/a', '/b']);
	});

	it('should report isFavorite correctly', () => {
		const store = useBookmarksStore();
		store.addFavorite('/home/user/Documents');
		expect(store.isFavorite('/home/user/Documents')).toBe(true);
		expect(store.isFavorite('/home/user/Downloads')).toBe(false);
	});

	it('should mark paths as non-existent', () => {
		const store = useBookmarksStore();
		store.addFavorite('/home/user/missing');
		store.markPathNonExistent('/home/user/missing');
		expect(store.favorites[0].exists).toBe(false);
	});

	it('should mark paths as existing again', () => {
		const store = useBookmarksStore();
		store.addFavorite('/home/user/dir');
		store.markPathNonExistent('/home/user/dir');
		expect(store.favorites[0].exists).toBe(false);
		store.markPathExists('/home/user/dir');
		expect(store.favorites[0].exists).toBe(true);
	});

	it('should persist favorites to localStorage', () => {
		const store = useBookmarksStore();
		store.addFavorite('/home/user/Documents');
		const stored = JSON.parse(localStorageMock.getItem('vasak-bookmarks-favorites') || '[]');
		expect(stored).toEqual(['/home/user/Documents']);
	});

	it('should extract name from path correctly', () => {
		const store = useBookmarksStore();
		store.addFavorite('/home/user/My Documents');
		expect(store.favorites[0].name).toBe('My Documents');

		store.addFavorite('/');
		expect(store.favorites[1].name).toBe('/');
	});
});
