<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

interface TagItem {
	id: string;
	name: string;
	color: string;
}

const props = withDefaults(
	defineProps<{
		tags: TagItem[];
		selectedTagIds: string[];
		allowCreate?: boolean;
		maxBadges?: number;
		fullWidth?: boolean;
		triggerVariant?: 'default' | 'ghost' | 'outline';
	}>(),
	{
		allowCreate: false,
		maxBadges: 3,
		fullWidth: false,
		triggerVariant: 'outline',
	}
);

const emit = defineEmits<{
	(event: 'toggle-tag', tagId: string): void;
	(event: 'create-tag', name: string): void;
	(event: 'delete-tag', tagId: string): void;
}>();

const isOpen = ref(false);
const newTagName = ref('');
const containerRef = ref<HTMLElement | null>(null);

const selectedTags = computed(() => {
	return props.tags.filter((tag) => props.selectedTagIds.includes(tag.id));
});

const visibleBadges = computed(() => selectedTags.value.slice(0, props.maxBadges));
const hiddenCount = computed(() => Math.max(selectedTags.value.length - props.maxBadges, 0));

const triggerClass = computed(() => {
	const base = 'inline-flex items-center gap-2 rounded-corner px-2 py-1 text-xs transition-colors';

	switch (props.triggerVariant) {
		case 'ghost':
			return `${base} hover:bg-secondary text-ui-text`;
		case 'default':
			return `${base} bg-ui-surface text-tx-main hover:bg-primary`;
		default:
			return `${base} border border-ui-border text-tx-primary hover:bg-primary`;
	}
});

function handleDocumentClick(event: MouseEvent) {
	const target = event.target as Node | null;
	if (!target || !containerRef.value) return;
	if (!containerRef.value.contains(target)) {
		isOpen.value = false;
	}
}

function toggleOpen() {
	isOpen.value = !isOpen.value;
}

function handleToggleTag(tagId: string) {
	emit('toggle-tag', tagId);
}

function handleCreateTag() {
	const trimmed = newTagName.value.trim();
	if (!trimmed) return;
	emit('create-tag', trimmed);
	newTagName.value = '';
}

function handleDeleteTag(tagId: string) {
	emit('delete-tag', tagId);
}

onMounted(() => {
	document.addEventListener('click', handleDocumentClick);
});

onUnmounted(() => {
	document.removeEventListener('click', handleDocumentClick);
});
</script>

<template>
	<div ref="containerRef" class="relative" :class="{ 'w-full': fullWidth }">
		<button type="button" :class="triggerClass" @click="toggleOpen">
			<span>Tags</span>
			<div class="flex items-center gap-1">
				<span
					v-for="tag in visibleBadges"
					:key="tag.id"
					class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]"
					:style="{ backgroundColor: tag.color, color: '#fff' }"
				>
					{{ tag.name }}
				</span>
				<span v-if="hiddenCount > 0" class="text-[10px] text-tx-muted">
					+{{ hiddenCount }}
				</span>
			</div>
		</button>

		<div
			v-if="isOpen"
			class="absolute z-50 mt-2 w-64 rounded-corner border border-ui-border bg-ui-bg/80 p-2 shadow-lg"
		>
			<div v-if="tags.length === 0" class="px-2 py-2 text-xs text-tx-muted">
				No tags available
			</div>
			<div v-else class="flex flex-col gap-1">
				<div
					v-for="tag in tags"
					:key="tag.id"
					class="flex items-center justify-between rounded-corner px-2 py-1 text-xs hover:bg-primary"
				>
					<button
						type="button"
						class="flex flex-1 items-center gap-2 text-left"
						@click="handleToggleTag(tag.id)"
					>
						<span class="h-2 w-2 rounded-full" :style="{ backgroundColor: tag.color }" />
						<span :class="{ 'font-semibold': selectedTagIds.includes(tag.id) }">
							{{ tag.name }}
						</span>
					</button>
					<button
						type="button"
						class="rounded px-1 text-[10px] text-tx-muted hover:text-tx-primary"
						@click="handleDeleteTag(tag.id)"
					>
						Delete
					</button>
				</div>
			</div>

			<div v-if="allowCreate" class="mt-2 flex items-center gap-2 border-t border-ui-border pt-2">
				<input
					v-model="newTagName"
					type="text"
					placeholder="New tag"
					class="w-full rounded-md border border-ui-border px-2 py-1 text-xs focus:border-ui-secondary focus:outline-none"
					@keydown.enter.prevent="handleCreateTag"
				/>
				<button
					type="button"
					class="rounded-md border border-ui-border px-2 py-1 text-xs text-tx-primary hover:bg-primary"
					@click="handleCreateTag"
				>
					Add
				</button>
			</div>
		</div>
	</div>
</template>
