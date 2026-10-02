/**
 * La cola de avisos del gestor de archivos.
 *
 * Los avisos se dibujan con `ToastArea` de la librería (`ToastContainer.vue`);
 * acá vive sólo la cola: cuándo aparece un aviso, cuánto dura y cuándo se va,
 * que son decisiones de la aplicación.
 *
 * Hasta la 0.24 cada aviso era un componente propio —`CustomSimple`,
 * `CustomError`, `CustomProgress`— con su tilde y su cruz en SVG y su caja con
 * `bg-ui-bg/80`. Ahora un aviso es un dato y la forma es la de todo el
 * escritorio. Los textos van como claves del catálogo (o como texto ya
 * traducido, que el catálogo devuelve tal cual): los traduce el contenedor.
 * Antes no los traducía nadie y el aviso mostraba la clave cruda,
 * «notifications.copied».
 */
import { ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'progress';

/**
 * El estado de una copia o un movimiento en curso, que el que lo lanzó va
 * cambiando: el aviso lo sigue porque se guarda el mismo objeto reactivo.
 */
export interface ProgressToastData {
	id: string | number;
	title: string;
	description: string;
	progress: number;
	actionText: string;
	operationType: 'copy' | 'move' | 'delete' | '';
	itemCount: number;
	/** Que falló: el aviso pasa al tono de error. */
	failed?: boolean;
	cleanup: () => void;
}

export interface QueuedToast {
	id: string | number;
	kind: ToastKind;
	title: string;
	description?: string;
	/** Sólo en los de progreso. */
	data?: ProgressToastData;
	/** Lo que hace el botón del aviso de progreso. */
	onAction?: () => void;
	timeoutId?: ReturnType<typeof setTimeout>;
}

const toasts = ref<Map<string | number, QueuedToast>>(new Map());
let nextId = 0;

function generateId(): string {
	return `toast-${nextId++}`;
}

function add(entry: Omit<QueuedToast, 'id'>, duration: number): string | number {
	const id = generateId();
	const queued: QueuedToast = { ...entry, id };

	if (duration !== Number.POSITIVE_INFINITY) {
		queued.timeoutId = setTimeout(() => dismiss(id), duration);
	}

	toasts.value.set(id, queued);
	return id;
}

function dismiss(id: string | number): void {
	const queued = toasts.value.get(id);
	if (queued?.timeoutId) clearTimeout(queued.timeoutId);
	toasts.value.delete(id);
}

function dismissAll(): void {
	for (const queued of toasts.value.values()) {
		if (queued.timeoutId) clearTimeout(queued.timeoutId);
	}
	toasts.value.clear();
}

interface MessageOptions {
	title: string;
	description?: string;
	/** En milisegundos. Por omisión, tres segundos. */
	duration?: number;
}

export const toast = {
	/** Algo salió bien: «se copió la dirección». */
	success: ({ title, description, duration = 3000 }: MessageOptions) =>
		add({ kind: 'success', title, description }, duration),
	/** Algo no se pudo hacer. */
	error: ({ title, description, duration = 3000 }: MessageOptions) =>
		add({ kind: 'error', title, description }, duration),
	/**
	 * Una operación larga. Se queda hasta que quien la lanzó la descarte con
	 * `dismiss`; el botón del aviso llama a `onAction`.
	 */
	progress: (data: ProgressToastData, onAction: () => void) =>
		add({ kind: 'progress', title: data.title, data, onAction }, Number.POSITIVE_INFINITY),
	dismiss,
	dismissAll,
};

export const useToast = () => ({ toasts, toast });
