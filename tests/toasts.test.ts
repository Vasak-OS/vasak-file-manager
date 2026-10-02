/**
 * Los avisos, con el `ToastArea` de la librería.
 *
 * Hasta la 0.24 cada aviso era un componente propio con su SVG y mostraba la
 * clave del catálogo sin traducir («notifications.copied»). Ahora un aviso es
 * un dato (`toaster.ts`) y `toast-notice.ts` lo traduce y lo arma.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { operationLabel, toNotice } from '@/components/ui/toast/toast-notice';
import { type ProgressToastData, toast, useToast } from '@/components/ui/toast/toaster';
import { randomTagColor, TAG_COLORS } from '@/data/tag-colors';

const translate = (key: string) => `«${key}»`;

function progressData(partial: Partial<ProgressToastData> = {}): ProgressToastData {
	return {
		id: '',
		title: 'notifications.copyingItems',
		description: '',
		progress: 40,
		actionText: 'cancel',
		operationType: 'copy',
		itemCount: 2,
		cleanup: () => {},
		...partial,
	};
}

afterEach(() => toast.dismissAll());

describe('la cola', () => {
	test('un aviso simple entra traducido y con su tono', () => {
		const id = toast.error({ title: 'notifications.undoFailed', description: 'sin permiso' });
		const queued = useToast().toasts.value.get(id);
		expect(queued).toBeDefined();

		expect(toNotice(queued as never, translate)).toEqual({
			id,
			tone: 'error',
			title: '«notifications.undoFailed»',
			message: '«sin permiso»',
		});
	});

	test('sin descripción, el título es el mensaje', () => {
		const id = toast.success({ title: 'notifications.renamed' });
		const queued = useToast().toasts.value.get(id);

		expect(toNotice(queued as never, translate)).toEqual({
			id,
			tone: 'success',
			message: '«notifications.renamed»',
		});
	});

	test('el de progreso se queda hasta que lo descarten', () => {
		const id = toast.progress(progressData(), () => {});
		expect(useToast().toasts.value.has(id)).toBe(true);

		toast.dismiss(id);
		expect(useToast().toasts.value.has(id)).toBe(false);
	});
});

describe('el aviso de una copia', () => {
	test('mientras corre: la barra, la etiqueta con la cantidad y el botón', () => {
		const notice = toNotice(
			{ id: 'a', kind: 'progress', title: '', data: progressData() },
			translate
		);

		expect(notice.tone).toBe('info');
		expect(notice.progress).toBe(40);
		expect(notice.message).toBe('«operations.copyingOther»');
		expect(notice.action).toEqual({ label: '«cancel»' });
	});

	test('al terminar, verde y «completado»', () => {
		const notice = toNotice(
			{
				id: 'a',
				kind: 'progress',
				title: '',
				data: progressData({ progress: 100, title: 'notifications.copied' }),
			},
			translate
		);

		expect(notice.tone).toBe('success');
		expect(notice.message).toBe('«progress.completed»');
	});

	test('si falló, rojo y sin barra', () => {
		const notice = toNotice(
			{
				id: 'a',
				kind: 'progress',
				title: '',
				data: progressData({ failed: true, progress: 0, itemCount: 0, description: 'sin lugar' }),
			},
			translate
		);

		expect(notice.tone).toBe('error');
		expect(notice.progress).toBeUndefined();
		expect(notice.description).toBe('«sin lugar»');
	});
});

describe('la etiqueta de cada operación', () => {
	test('mover y borrar tienen la suya, y una sin cantidad no la lleva', () => {
		expect(operationLabel(progressData({ operationType: 'move', itemCount: 1 }), translate)).toBe(
			'«operations.movingOne»'
		);
		expect(operationLabel(progressData({ operationType: 'delete' }), translate)).toBe(
			'«operations.deletingOther»'
		);
		expect(operationLabel(progressData({ operationType: '' }), translate)).toBe('');
		expect(operationLabel(progressData({ itemCount: 0 }), translate)).toBe('');
	});

	test('sin etiqueta, el mensaje es el título; sin botón, no hay acción', () => {
		const notice = toNotice(
			{
				id: 'a',
				kind: 'progress',
				title: '',
				data: progressData({ operationType: '', actionText: '' }),
			},
			translate
		);

		expect(notice.message).toBe('«notifications.copyingItems»');
		expect(notice.action).toBeUndefined();
	});
});

describe('los colores de las etiquetas', () => {
	test('una etiqueta nueva sale de la paleta', () => {
		expect(TAG_COLORS).toContain(randomTagColor(() => 0));
		expect(TAG_COLORS).toContain(randomTagColor(() => 0.999));
	});
});
