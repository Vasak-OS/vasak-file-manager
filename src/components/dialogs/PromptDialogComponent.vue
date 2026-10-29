<script setup lang="ts">
import {
	ActionButton,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	FormGroup,
	TextInput,
} from '@vasakgroup/vue-libvasak';
import { computed, nextTick, ref, watch } from 'vue';

/**
 * Diálogo genérico de «pedir un texto y confirmar»: el shell compartido por
 * `NewItemDialog`, `SelectByPatternDialog` y cualquier otro que pida una línea.
 * El padre pone el título, la etiqueta, el texto del botón y la validación; acá
 * vive el foco al abrir, Enter para confirmar y el estilo de inválido.
 */
const props = withDefaults(
	defineProps<{
		title: string;
		label: string;
		confirmLabel: string;
		selectOnOpen?: boolean;
		loading?: boolean;
		/** Enmascara el campo y no recorta el valor: una clave puede llevar espacios. */
		password?: boolean;
		validate?: (value: string) => boolean;
	}>(),
	{ selectOnOpen: false, loading: false, password: false }
);

const isOpen = defineModel<boolean>('open', { required: true });
const value = defineModel<string>('value', { default: '' });

const emit = defineEmits<{
	confirm: [value: string];
	cancel: [];
}>();

/**
 * El campo es el `TextInput` de la librería, cuya raíz es el `<input>`: se toma
 * de ahí para enfocarlo (y, opcionalmente, seleccionar su texto) al abrir, que
 * la librería no expone.
 */
const field = ref<InstanceType<typeof TextInput> | null>(null);
const inputRef = computed(() => (field.value?.$el as HTMLInputElement | undefined) ?? null);

const trimmed = computed(() => (props.password ? value.value : value.value.trim()));
const isValid = computed(() =>
	props.validate ? props.validate(trimmed.value) : trimmed.value.length > 0
);

watch(isOpen, (open) => {
	if (open) {
		nextTick(() => {
			inputRef.value?.focus();
			if (props.selectOnOpen) inputRef.value?.select();
		});
	} else {
		emit('cancel');
	}
});

function handleSubmit() {
	if (!isValid.value || props.loading) return;
	emit('confirm', trimmed.value);
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter' && isValid.value) {
		event.preventDefault();
		handleSubmit();
	}
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent size="sm" class="overflow-x-hidden [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
      </DialogHeader>

      <div class="flex w-full min-w-0 flex-col gap-4">
        <FormGroup :label="label" html-for="prompt-dialog-input">
          <div class="flex w-full min-w-0 items-center gap-2">
            <TextInput id="prompt-dialog-input" ref="field" v-model="value" class="min-w-0 flex-1"
              :type="password ? 'password' : 'text'" :invalid="Boolean(value) && !isValid" @keydown="handleKeydown" />
            <ActionButton :label="confirmLabel" :disabled="!isValid" :loading="loading" @click="handleSubmit" />
          </div>
        </FormGroup>
      </div>

      <DialogFooter />
    </DialogContent>
  </Dialog>
</template>
