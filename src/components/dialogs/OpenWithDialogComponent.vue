<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed, ref, watch } from 'vue';
import Dialog from '@/components/ui/dialog/Dialog.vue';
import DialogContent from '@/components/ui/dialog/DialogContent.vue';
import DialogFooter from '@/components/ui/dialog/DialogFooter.vue';
import DialogHeader from '@/components/ui/dialog/DialogHeader.vue';
import DialogTitle from '@/components/ui/dialog/DialogTitle.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';
import TooltipContent from '@/components/ui/tooltip/TooltipContent.vue';
import TooltipTrigger from '@/components/ui/tooltip/TooltipTrigger.vue';
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
    <DialogContent class="w-[480px] max-w-[calc(100vw-32px)] box-border overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>{{ t('openWith.customCommands') }}</DialogTitle>
      </DialogHeader>

      <div class="flex w-full min-w-0 flex-col gap-4">
        <div v-if="loadError" class="p-3 rounded-md bg-destructive/10 text-destructive text-[13px]">
          {{ loadError }}
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ t('openWith.customCommands') }}</span>
            <button type="button" @click="startAddingCommand">
              <PlusIcon :size="16" />
              {{ t('openWith.addCustomCommand') }}
            </button>
          </div>

          <ScrollArea v-if="customCommands.length > 0" class="max-h-[200px]">
            <div v-for="command in customCommands" :key="command.id" class="group flex items-center justify-between px-3 py-2 rounded-md bg-transparent cursor-pointer gap-2 transition-colors duration-150 hover:bg-muted/50"
              :class="{ '!bg-primary/15 hover:!bg-primary/20': selectedCommandId === command.id }"
              @click="selectedCommandId = command.id" @dblclick="runCommand(command)">
              <div class="flex overflow-hidden flex-1 items-center gap-2.5">
                <FileIcon :size="16" class="shrink-0 text-muted-foreground" />
                <div class="flex overflow-hidden flex-col gap-0.5">
                  <span class="text-foreground text-sm font-medium">{{ command.name }}</span>
                  <span class="overflow-hidden text-muted-foreground text-xs text-ellipsis whitespace-nowrap">{{ command.programPath }}</span>
                </div>
              </div>
              <div class="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button type="button" @click.stop="runCommand(command)">
                      <PlayIcon :size="14" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>'run'</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button type="button" @click.stop="startEditingCommand(command)">
                      <InfoIcon :size="14" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>'edit'</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button type="button" class="hover:text-destructive"
                      @click.stop="deleteCommand(command.id)">
                      <Trash2Icon :size="14" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{{ t('fileBrowser.actions.delete') }}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </ScrollArea>

          <div v-else-if="!isAddingCommand" class="p-6 border border-dashed border-ui-border rounded-md text-muted-foreground text-[13px] text-center">
            {{ t('openWith.noCustomCommands') }}
          </div>
        </div>

        <div v-if="isAddingCommand || editingCommandId" class="flex flex-col p-4 border border-ui-border rounded-md bg-muted/30 gap-3">
          <div class="mb-1">
            <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {{ t(editingCommandId ? 'openWith.editCustomCommand' : 'openWith.addCustomCommand') }}
            </span>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-foreground text-[13px] font-medium">{{ t('openWith.commandName') }}</label>
            <input v-model="newCommandName" type="text" :placeholder="t('openWith.commandNamePlaceholder')" />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-foreground text-[13px] font-medium">{{ t('openWith.programPath') }}</label>
            <div class="flex gap-2">
              <input v-model="newCommandPath" type="text" :placeholder="t('openWith.enterProgramPath')"
                class="flex-1" />
              <button type="button" :title="t('browse')" @click="handleSelectProgram">
                <FolderOpenIcon :size="16" />
              </button>
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-1.5">
              <label class="text-foreground text-[13px] font-medium">{{ t('openWith.arguments') }}</label>
              <Tooltip>
                <TooltipTrigger as-child>
                  <InfoIcon :size="14" class="text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{{ t('openWith.argumentsHint') }}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <input v-model="newCommandArgs" type="text" :placeholder="t('openWith.argumentsPlaceholder')" />
          </div>

          <div class="flex justify-end mt-2 gap-2">
            <button type="button" @click="cancelEditing">
              'cancel'
            </button>
            <button type="button" :disabled="!canSaveCommand" @click="saveCommand">
              'save'
            </button>
          </div>
        </div>
      </div>

      <DialogFooter class="flex justify-end gap-2">
        <button type="button" :disabled="isOpening" @click="handleClose">
          'cancel'
        </button>
        <button type="button" :disabled="!canRun || isOpening" @click="handleRunSelected">
          <Loader2Icon v-if="isOpening" :size="16" class="animate-spin" />
          'openWith.open'
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
