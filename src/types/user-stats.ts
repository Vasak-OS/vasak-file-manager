import { DEFAULT_TAG_COLORS } from '@/data/tag-colors';

export interface ItemTag {
	id: string;
	name: string;
	color: string;
}

export interface TaggedItem {
	path: string;
	tagIds: string[];
	addedAt: number;
	isFile: boolean;
}

export interface FavoriteItem {
	path: string;
	addedAt: number;
}

export interface HistoryItem {
	path: string;
	openedAt: number;
	isFile: boolean;
}

export interface FrequentItem {
	path: string;
	openCount: number;
	lastOpenedAt: number;
	isFile: boolean;
}

export interface UserStats {
	favorites: FavoriteItem[];
	tags: ItemTag[];
	taggedItems: TaggedItem[];
	history: HistoryItem[];
	frequentItems: FrequentItem[];
}

export const DEFAULT_USER_STATS: UserStats = {
	favorites: [],
	tags: [
		{
			id: 'tag-important',
			name: 'Important',
			color: DEFAULT_TAG_COLORS.important,
		},
		{
			id: 'tag-work',
			name: 'Work',
			color: DEFAULT_TAG_COLORS.work,
		},
		{
			id: 'tag-personal',
			name: 'Personal',
			color: DEFAULT_TAG_COLORS.personal,
		},
		{
			id: 'tag-archive',
			name: 'Archive',
			color: DEFAULT_TAG_COLORS.archive,
		},
	],
	taggedItems: [],
	history: [],
	frequentItems: [],
};
