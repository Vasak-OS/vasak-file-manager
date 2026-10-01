/**
 * Un aviso de la cola (`toaster.ts`), como lo pide `ToastArea`.
 *
 * Acá se traduce y se arma cada aviso: el título, el mensaje, la barra y el
 * botón. La etiqueta de una copia en curso es la frase entera del catálogo con
 * la cantidad adentro («Copiando 2 archivos»), con sus dos formas para uno y
 * para varios; antes eran tres pedazos pegados y el sustantivo iba en duro en
 * español.
 *
 * El tono dice el **estado** y no el avance: neutro mientras corre, verde al
 * terminar, rojo si falló. El largo de la barra es el que dice cuánto falta.
 */
import type { ToastNotice } from '@vasakgroup/vue-libvasak';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';
import type { ProgressToastData, QueuedToast } from './toaster';

type Translate = (key: string) => string;

export function operationLabel(data: ProgressToastData, translate: Translate): string {
	const base =
		data.operationType === 'copy'
			? 'operations.copying'
			: data.operationType === 'move'
				? 'operations.moving'
				: data.operationType === 'delete'
					? 'operations.deleting'
					: '';
	if (!base || data.itemCount <= 0) return '';
	return interpolar(translate(claveSegunCantidad(base, data.itemCount)), data.itemCount);
}

export function toNotice(queued: QueuedToast, translate: Translate): ToastNotice {
	if (queued.kind !== 'progress' || !queued.data) {
		const tone = queued.kind === 'error' ? 'error' : 'success';
		return queued.description
			? {
					id: queued.id,
					tone,
					title: translate(queued.title),
					message: translate(queued.description),
				}
			: { id: queued.id, tone, message: translate(queued.title) };
	}

	const data = queued.data;
	const progress = Math.round(data.progress);
	const complete = !data.failed && progress >= 100;
	const label = operationLabel(data, translate);
	return {
		id: queued.id,
		tone: data.failed ? 'error' : complete ? 'success' : 'info',
		title: translate(data.title),
		message: complete ? translate('progress.completed') : label || translate(data.title),
		description: data.description ? translate(data.description) : undefined,
		progress: data.failed ? undefined : progress,
		action: data.actionText ? { label: translate(data.actionText) } : undefined,
	};
}
