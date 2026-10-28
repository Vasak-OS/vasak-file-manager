<script setup lang="ts">
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	FormGroup,
	NumberField,
	SegmentedControl,
	TextInput,
} from '@vasakgroup/vue-libvasak';
import { computed, ref, watch } from 'vue';
import type { DirEntry } from '@/types/dir-entry';
import {
	type BatchRenameCase,
	type BatchRenameError,
	type BatchRenamePattern,
	computeBatchRename,
	DEFAULT_BATCH_RENAME_PATTERN,
} from '@/utils/batch-rename';

const props = defineProps<{
	entries: DirEntry[];
	/** Nombres que ya hay en la carpeta, para detectar choques. */
	existingNames?: Set<string>;
}>();

const emit = defineEmits<{
	confirm: [renames: { sourcePath: string; newName: string }[]];
	cancel: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

const pattern = ref<BatchRenamePattern>({ ...DEFAULT_BATCH_RENAME_PATTERN });
const isSubmitting = ref(false);

const rows = computed(() => computeBatchRename(props.entries, pattern.value, props.existingNames));
const changedRows = computed(() => rows.value.filter((row) => row.newName !== row.oldName));
const hasErrors = computed(() => rows.value.some((row) => row.error));
const canApply = computed(() => !hasErrors.value && changedRows.value.length > 0);

const caseOptions = computed<{ value: BatchRenameCase; label: string }[]>(() => [
	{ value: 'none', label: t('dialogs.batchRenameDialog.caseNone') },
	{ value: 'upper', label: t('dialogs.batchRenameDialog.caseUpper') },
	{ value: 'lower', label: t('dialogs.batchRenameDialog.caseLower') },
]);

const ERROR_KEYS: Record<BatchRenameError, string> = {
	empty: 'dialogs.batchRenameDialog.errorEmpty',
	invalid: 'dialogs.batchRenameDialog.errorInvalid',
	collision: 'dialogs.batchRenameDialog.errorCollision',
};

watch(
	pattern,
	() => {
		isSubmitting.value = false;
	},
	{ deep: true }
);

watch(isOpen, (open) => {
	if (open) {
		pattern.value = { ...DEFAULT_BATCH_RENAME_PATTERN };
		isSubmitting.value = false;
	} else {
		emit('cancel');
	}
});

function handleSubmit() {
	if (!canApply.value || isSubmitting.value) return;

	isSubmitting.value = true;
	// Sólo viajan las entradas cuyo nombre cambia.
	emit(
		'confirm',
		changedRows.value.map((row) => ({ sourcePath: row.entry.path, newName: row.newName }))
	);
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter' && canApply.value) {
		event.preventDefault();
		handleSubmit();
	}
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent size="lg" class="overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>{{ t('dialogs.batchRenameDialog.title') }}</DialogTitle>
      </DialogHeader>

      <!-- El contenedor decide: en una ventana angosta los campos van uno por fila. -->
      <div class="@container flex w-full min-w-0 flex-col gap-4">
        <div class="grid grid-cols-1 gap-3 @lg:grid-cols-2">
          <FormGroup :label="t('dialogs.batchRenameDialog.find')" html-for="batch-rename-find">
            <TextInput id="batch-rename-find" v-model="pattern.find" @keydown="handleKeydown" />
          </FormGroup>
          <FormGroup :label="t('dialogs.batchRenameDialog.replace')" html-for="batch-rename-replace">
            <TextInput id="batch-rename-replace" v-model="pattern.replace" @keydown="handleKeydown" />
          </FormGroup>
        </div>

        <FormGroup :label="t('dialogs.batchRenameDialog.template')" html-for="batch-rename-template"
          :help="t('dialogs.batchRenameDialog.templateHelp')">
          <TextInput id="batch-rename-template" v-model="pattern.template" @keydown="handleKeydown" />
        </FormGroup>

        <div class="grid grid-cols-2 gap-3 @lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div class="col-span-2 min-w-0 @lg:col-span-1">
            <SegmentedControl :model-value="pattern.caseMode" :options="caseOptions"
              @update:model-value="(value) => (pattern.caseMode = value ?? 'none')"
              :label="t('dialogs.batchRenameDialog.caseMode')" />
          </div>
          <FormGroup :label="t('dialogs.batchRenameDialog.startAt')" html-for="batch-rename-start">
            <NumberField id="batch-rename-start" v-model="pattern.startAt" :min="0" />
          </FormGroup>
          <FormGroup :label="t('dialogs.batchRenameDialog.padding')" html-for="batch-rename-padding">
            <NumberField id="batch-rename-padding" v-model="pattern.padding" :min="1" :max="20" />
          </FormGroup>
        </div>

        <div class="max-h-64 min-w-0 overflow-y-auto rounded-corner-m border border-ui-line bg-ui-surface/70">
          <table class="w-full table-fixed border-collapse text-body-s" :aria-label="t('dialogs.batchRenameDialog.preview')">
            <thead class="sticky top-0 bg-ui-surface text-body-xs text-tx-muted">
              <tr>
                <th scope="col" class="px-3 py-1.5 text-left font-medium">{{ t('dialogs.batchRenameDialog.oldName') }}</th>
                <th scope="col" class="px-3 py-1.5 text-left font-medium">{{ t('dialogs.batchRenameDialog.newName') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.entry.path" class="border-t border-ui-line-weak"
                :class="row.error ? 'bg-status-error/10' : ''">
                <td class="min-w-0 px-3 py-1.5 align-top text-tx-muted">
                  <span class="block truncate" :title="row.oldName">{{ row.oldName }}</span>
                </td>
                <td class="min-w-0 px-3 py-1.5 align-top" :class="row.error ? 'text-status-error' : 'text-tx-main'">
                  <span class="block truncate" :title="row.newName">{{ row.newName || '…' }}</span>
                  <span v-if="row.error" class="block text-body-xs">{{ t(ERROR_KEYS[row.error]) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <DialogFooter>
        <ActionButton :label="t('dialogs.batchRenameDialog.apply')" :disabled="!canApply" :loading="isSubmitting"
          @click="handleSubmit" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
