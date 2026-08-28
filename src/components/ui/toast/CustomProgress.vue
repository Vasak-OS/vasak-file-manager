<script lang="ts" setup>
import { useI18n } from '@vasakgroup/tauri-plugin-i18n';
import { computed } from 'vue';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';

const { t } = useI18n();

interface ToastData {
	id: string | number;
	title: string;
	description: string;
	progress: number;
	actionText: string;
	cleanup: () => void;
	operationType: 'copy' | 'move' | 'delete' | '';
	itemCount: number;
}

interface Props {
	data: ToastData;
	onAction: () => void;
}

const props = defineProps<Props>();

const displayProgress = computed(() => Math.round(props.data.progress));
const isComplete = computed(() => displayProgress.value >= 100);

/**
 * La etiqueta completa, con la cantidad adentro.
 *
 * Antes eran tres pedazos pegados: el verbo traducido, el número, y el sustantivo
 * **en duro en español**. En inglés salía «Copying 2 archivos». Ahora la frase
 * entera vive en el catálogo, con sus dos formas para uno y para varios.
 */
const operationLabel = computed(() => {
	const base =
		props.data.operationType === 'copy'
			? 'operations.copying'
			: props.data.operationType === 'move'
				? 'operations.moving'
				: props.data.operationType === 'delete'
					? 'operations.deleting'
					: '';
	if (!base) return '';
	return interpolar(t(claveSegunCantidad(base, props.data.itemCount)), props.data.itemCount);
});

/**
 * El color de la barra según el **estado**, no según el porcentaje.
 *
 * Antes cambiaba de azul a cian a verde a medida que avanzaba, así que una
 * operación al 85 % se veía del verde de «listo» sin haber terminado, y el mismo
 * verde significaba dos cosas distintas en la misma ventana —acá «va avanzando» y
 * en el centro de estado «terminó»—. El color codifica estado, no progreso: para
 * eso está el largo de la barra.
 */
const progressColor = computed(() =>
	displayProgress.value >= 100 ? 'bg-status-success' : 'bg-primary'
);
</script>

<template>
  <div class="flex flex-col gap-3 w-full max-w-md p-4 rounded-corner bg-ui-bg/80 border border-ui-border">
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <div class="flex-1 min-w-0">
        <h3 class="font-semibold text-sm text-tx-main truncate">{{ data.title }}</h3>
        <p v-if="data.description" class="text-xs text-tx-muted mt-1">{{ data.description }}</p>
      </div>
      <button v-if="!isComplete" @click="onAction" class="px-2 py-1 text-xs font-medium text-tx-muted hover:text-tx-main transition-colors flex-shrink-0">
        {{ data.actionText }}
      </button>
    </div>

    <!-- Progress Bar -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between text-xs text-tx-muted">
        <span>{{ operationLabel }}</span>
        <span class="font-medium">{{ displayProgress }}%</span>
      </div>
      <div class="w-full h-2 bg-ui-surface rounded-full overflow-hidden">
        <div
          :class="[progressColor, 'h-full transition-all duration-300']"
          :style="{ width: `${displayProgress}%` }"
        />
      </div>
    </div>

    <!-- Complete State -->
    <div v-if="isComplete" class="flex items-center justify-between pt-2 border-t border-ui-border">
      <span class="text-xs text-status-success">✓ {{ t('progress.completed') }}</span>
      <button @click="onAction" class="px-2 py-1 text-xs font-medium text-tx-muted hover:text-tx-main transition-colors">
        {{ data.actionText }}
      </button>
    </div>
  </div>
</template>


