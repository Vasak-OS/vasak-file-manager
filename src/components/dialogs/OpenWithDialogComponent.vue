<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import {
	ActionButton,
	AlertMessage,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	EmptyState,
	FormGroup,
	ListRow,
	SectionHeading,
	TextInput,
	ThemeIcon,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@vasakgroup/vue-libvasak';
import { computed, ref, watch } from 'vue';
import type { DirEntry } from '@/types/dir-entry';

interface CustomCommand {
	id: string;
	name: string;
	programPath: string;
	arguments: string;
}

interface OpenWithResult {
	success: boolean;
	error: string | null;
}

const props = defineProps<{
	entries: DirEntry[];
}>();

const emit = defineEmits<{
	close: [];
	opened: [];
}>();

const { t } = useI18n();

const isOpen = defineModel<boolean>('open', { required: true });

const isOpening = ref(false);
const loadError = ref<string | null>(null);

const customCommands = ref<CustomCommand[]>([]);
const selectedCommandId = ref<string | null>(null);

const isAddingCommand = ref(false);
const editingCommandId = ref<string | null>(null);

const newCommandName = ref('');
const newCommandPath = ref('');
const newCommandArgs = ref('');

function loadCustomCommands() {
	const stored = localStorage.getItem('sigma-custom-open-commands');

	if (stored) {
		try {
			customCommands.value = JSON.parse(stored);
		} catch {
			customCommands.value = [];
		}
	}
}

function saveCustomCommands() {
	localStorage.setItem('sigma-custom-open-commands', JSON.stringify(customCommands.value));
}

watch(isOpen, (open) => {
	if (open) {
		loadCustomCommands();
		selectedCommandId.value = null;
		isAddingCommand.value = false;
		editingCommandId.value = null;
		resetNewCommandForm();
		loadError.value = null;
	}
});

function resetNewCommandForm() {
	newCommandName.value = '';
	newCommandPath.value = '';
	newCommandArgs.value = '';
}

function startAddingCommand() {
	isAddingCommand.value = true;
	editingCommandId.value = null;
	resetNewCommandForm();
}

function startEditingCommand(command: CustomCommand) {
	isAddingCommand.value = false;
	editingCommandId.value = command.id;
	newCommandName.value = command.name;
	newCommandPath.value = command.programPath;
	newCommandArgs.value = command.arguments;
}

function cancelEditing() {
	isAddingCommand.value = false;
	editingCommandId.value = null;
	resetNewCommandForm();
}

async function handleSelectProgram() {
	const selected = await openDialog({
		title: 'openWith.selectProgram',
		filters: [
			{
				name: 'Executables',
				extensions: ['exe', 'bat', 'cmd', 'com'],
			},
			{
				name: 'All Files',
				extensions: ['*'],
			},
		],
	});

	if (selected && typeof selected === 'string') {
		newCommandPath.value = selected;
	}
}

function saveCommand() {
	if (!newCommandName.value.trim() || !newCommandPath.value.trim()) {
		return;
	}

	if (editingCommandId.value) {
		const index = customCommands.value.findIndex((cmd) => cmd.id === editingCommandId.value);

		if (index !== -1) {
			customCommands.value[index] = {
				id: editingCommandId.value,
				name: newCommandName.value.trim(),
				programPath: newCommandPath.value.trim(),
				arguments: newCommandArgs.value.trim(),
			};
		}
	} else {
		customCommands.value.push({
			id: crypto.randomUUID(),
			name: newCommandName.value.trim(),
			programPath: newCommandPath.value.trim(),
			arguments: newCommandArgs.value.trim(),
		});
	}

	saveCustomCommands();
	cancelEditing();
}

function deleteCommand(commandId: string) {
	customCommands.value = customCommands.value.filter((cmd) => cmd.id !== commandId);
	saveCustomCommands();

	if (selectedCommandId.value === commandId) {
		selectedCommandId.value = null;
	}

	if (editingCommandId.value === commandId) {
		cancelEditing();
	}
}

function parseArguments(argsString: string): string[] {
	if (!argsString.trim()) return [];

	const args: string[] = [];
	let current = '';
	let inQuotes = false;
	let quoteChar = '';

	for (const char of argsString) {
		if ((char === '"' || char === "'") && !inQuotes) {
			inQuotes = true;
			quoteChar = char;
		} else if (char === quoteChar && inQuotes) {
			inQuotes = false;
			quoteChar = '';
		} else if (char === ' ' && !inQuotes) {
			if (current) {
				args.push(current);
				current = '';
			}
		} else {
			current += char;
		}
	}

	if (current) {
		args.push(current);
	}

	return args;
}

async function runCommand(command: CustomCommand) {
	isOpening.value = true;
	loadError.value = null;

	try {
		const args = parseArguments(command.arguments);

		for (const entry of props.entries) {
			const result = await invoke<OpenWithResult>('open_with_program', {
				filePath: entry.path,
				programPath: command.programPath,
				arguments: args,
			});

			if (!result.success) {
				loadError.value = result.error || 'openWith.failedToOpenFile';
				isOpening.value = false;
				return;
			}
		}

		emit('opened');
		isOpen.value = false;
	} catch (invokeError) {
		loadError.value = String(invokeError);
	} finally {
		isOpening.value = false;
	}
}

function handleRunSelected() {
	const command = customCommands.value.find((cmd) => cmd.id === selectedCommandId.value);

	if (command) {
		runCommand(command);
	}
}

function handleClose() {
	emit('close');
	isOpen.value = false;
}

const canRun = computed(() => {
	return selectedCommandId.value !== null;
});

const canSaveCommand = computed(() => {
	return newCommandName.value.trim() !== '' && newCommandPath.value.trim() !== '';
});
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent size="md" class="overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>{{ t('openWith.customCommands') }}</DialogTitle>
      </DialogHeader>

      <div class="flex w-full min-w-0 flex-col gap-4">
        <AlertMessage v-if="loadError" tone="error">{{ loadError }}</AlertMessage>

        <div class="flex flex-col gap-2">
          <SectionHeading :title="t('openWith.customCommands')" variant="eyebrow" as="h3">
            <template #actions>
              <ActionButton :label="t('openWith.addCustomCommand')" icon="list-add" variant="ghost" size="sm"
                @click="startAddingCommand" />
            </template>
          </SectionHeading>

          <!-- La barra de desplazamiento la pone `scrollbar.css`. -->
          <div v-if="customCommands.length > 0" class="flex max-h-50 flex-col gap-0.5 overflow-y-auto" role="listbox"
            :aria-label="t('openWith.customCommands')">
            <!-- El doble clic lo atiende el envoltorio: `ListRow` declara sólo
                 `click`. -->
            <div v-for="command in customCommands" :key="command.id" role="none" class="group" @dblclick="runCommand(command)">
            <ListRow
              role="option"
              :title="command.name"
              :description="command.programPath"
              icon="application-x-executable"
              icon-type="symbol"
              :selected="selectedCommandId === command.id"
              truncate
              @click="selectedCommandId = command.id">
              <template #trailing>
                <div class="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 ease-ui group-hover:opacity-100 group-focus-within:opacity-100">
                  <Tooltip>
                    <TooltipTrigger>
                      <ActionButton label="" :icon-alt="t('run')" icon="media-playback-start" variant="ghost" size="sm"
                        stop-propagation @click="runCommand(command)" />
                    </TooltipTrigger>
                    <TooltipContent>{{ t('run') }}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger>
                      <ActionButton label="" :icon-alt="t('edit')" icon="document-edit" variant="ghost" size="sm"
                        stop-propagation @click="startEditingCommand(command)" />
                    </TooltipTrigger>
                    <TooltipContent>{{ t('edit') }}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger>
                      <ActionButton label="" :icon-alt="t('fileBrowser.actions.delete')" icon="edit-delete" variant="ghost"
                        size="sm" stop-propagation @click="deleteCommand(command.id)" />
                    </TooltipTrigger>
                    <TooltipContent>{{ t('fileBrowser.actions.delete') }}</TooltipContent>
                  </Tooltip>
                </div>
              </template>
            </ListRow>
            </div>
          </div>

          <EmptyState v-else-if="!isAddingCommand" :title="t('openWith.noCustomCommands')" icon="" size="sm" bordered />
        </div>

        <div v-if="isAddingCommand || editingCommandId" class="flex flex-col gap-3 rounded-corner-l border border-ui-line bg-ui-surface/30 p-4">
          <SectionHeading
            :title="t(editingCommandId ? 'openWith.editCustomCommand' : 'openWith.addCustomCommand')"
            variant="eyebrow"
            as="h3" />

          <FormGroup :label="t('openWith.commandName')" html-for="open-with-name">
            <TextInput id="open-with-name" v-model="newCommandName" :placeholder="t('openWith.commandNamePlaceholder')" />
          </FormGroup>

          <FormGroup :label="t('openWith.programPath')" html-for="open-with-path">
            <div class="flex min-w-0 gap-2">
              <TextInput id="open-with-path" v-model="newCommandPath" :placeholder="t('openWith.enterProgramPath')"
                class="min-w-0 flex-1" />
              <ActionButton label="" :icon-alt="t('browse')" :title="t('browse')" icon="folder-open" variant="secondary"
                @click="handleSelectProgram" />
            </div>
          </FormGroup>

          <!-- La pista de los argumentos sigue en su globo, al lado de la
               etiqueta: escrita abajo del campo sumaba un párrafo al diálogo. -->
          <div class="flex min-w-0 flex-col gap-1">
            <div class="flex items-center gap-1.5">
              <label for="open-with-args" class="text-label-s text-tx-muted">{{ t('openWith.arguments') }}</label>
              <Tooltip>
                <TooltipTrigger>
                  <ThemeIcon name="dialog-information" type="symbol" :size="14" class="cursor-help text-tx-muted" />
                </TooltipTrigger>
                <TooltipContent>
                  <p class="m-0">{{ t('openWith.argumentsHint') }}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <TextInput id="open-with-args" v-model="newCommandArgs" :placeholder="t('openWith.argumentsPlaceholder')" />
          </div>

          <div class="mt-2 flex justify-end gap-2">
            <ActionButton :label="t('cancel')" variant="secondary" @click="cancelEditing" />
            <ActionButton :label="t('save')" :disabled="!canSaveCommand" @click="saveCommand" />
          </div>
        </div>
      </div>

      <DialogFooter class="flex justify-end gap-2">
        <ActionButton :label="t('cancel')" variant="secondary" :disabled="isOpening" @click="handleClose" />
        <ActionButton :label="t('openWith.open')" :disabled="!canRun" :loading="isOpening" @click="handleRunSelected" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
