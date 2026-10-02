<script setup lang="ts">
/**
 * El selector de etiquetas del menú de acciones.
 *
 * El panel se abre **en el lugar**, colgado del botón, y no teletransportado
 * como un `Popover`: vive adentro de un menú desplegable, y un clic en algo
 * que está fuera del menú lo cierra —con el selector adentro—. Las piezas sí
 * son de la librería: `Badge` y `StatusDot` con el color de la etiqueta, que es
 * un dato (sólo tiñe el punto y el canto; el texto queda en el del esquema y no
 * en un blanco fijo), `TextInput` y `ActionButton`.
 */
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { ActionButton, Badge, StatusDot, TextInput } from '@vasakgroup/vue-libvasak';
import { computed, onMounted, onUnmounted, ref } from 'vue';

const { t } = useI18n();

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
	const base =
		'inline-flex min-h-8 min-w-0 items-center gap-2 rounded-corner-m px-2 py-1 text-label-s text-tx-main transition-colors duration-200 ease-ui hover:bg-ui-hover active:bg-ui-pressed';

	switch (props.triggerVariant) {
		case 'ghost':
			return base;
		case 'default':
			return `${base} bg-ui-surface/70`;
		default:
			return `${base} border border-ui-line`;
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
	<div ref="containerRef" class="relative min-w-0" :class="{ 'w-full': fullWidth }">
		<button type="button" :class="[triggerClass, fullWidth ? 'w-full' : '']" :aria-expanded="isOpen" @click="toggleOpen">
			<span class="truncate">{{ t('tags.title') }}</span>
			<span class="flex min-w-0 items-center gap-1">
				<Badge v-for="tag in visibleBadges" :key="tag.id" :color="tag.color" size="sm" :label="tag.name" />
				<span v-if="hiddenCount > 0" class="text-label-xs text-tx-muted">
					+{{ hiddenCount }}
				</span>
			</span>
		</button>

		<div
			v-if="isOpen"
			class="absolute z-50 mt-2 w-64 max-w-[calc(100vw-32px)] rounded-corner-l border border-ui-line bg-ui-float p-2 text-tx-main shadow-surface-m"
		>
			<p v-if="tags.length === 0" class="m-0 px-2 py-2 text-body-xs text-tx-muted">
				{{ t('tags.noTags') }}
			</p>
			<div v-else class="flex flex-col gap-1">
				<div
					v-for="tag in tags"
					:key="tag.id"
					class="flex min-w-0 items-center justify-between gap-1 rounded-corner-m px-1 transition-colors duration-200 ease-ui hover:bg-ui-hover"
				>
					<button
						type="button"
						class="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-1 text-left text-label-s"
						:aria-pressed="selectedTagIds.includes(tag.id)"
						@click="handleToggleTag(tag.id)"
					>
						<StatusDot :color="tag.color" />
						<span class="truncate" :class="{ 'font-semibold': selectedTagIds.includes(tag.id) }">
							{{ tag.name }}
						</span>
					</button>
					<ActionButton :label="t('tags.delete')" variant="ghost" size="sm" @click="handleDeleteTag(tag.id)" />
				</div>
			</div>

			<div v-if="allowCreate" class="mt-2 flex min-w-0 items-center gap-2 border-t border-ui-line-weak pt-2">
				<TextInput
					v-model="newTagName"
					class="min-w-0 flex-1"
					:placeholder="t('tags.newTag')"
					:ariaLabel="t('tags.newTag')"
					@keydown="($event) => { if ($event.key === 'Enter') { $event.preventDefault(); handleCreateTag(); } }"
				/>
				<ActionButton :label="t('tags.add')" variant="secondary" size="sm" @click="handleCreateTag" />
			</div>
		</div>
	</div>
</template>
