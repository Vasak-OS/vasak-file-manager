/**
 * Formatea una fecha a un formato legible localizado
 * @param date - La fecha a formatear
 * @param locale - Código de idioma (ej: 'es-ES', 'en-US')
 * @returns Fecha formateada en formato legible
 */
export function formatDateReadable(date: Date | number, locale: string = 'es-ES'): string {
	const dateObj = typeof date === 'number' ? new Date(date) : date;

	return dateObj.toLocaleDateString(locale, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

/**
 * Formatea una fecha a formato corto (DD/MM/YYYY)
 * @param date - La fecha a formatear
 * @returns Fecha en formato corto
 */
export function formatDateShort(date: Date | number): string {
	const dateObj = typeof date === 'number' ? new Date(date) : date;

	return dateObj.toLocaleDateString('es-ES', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});
}

/**
 * Formatea una fecha a formato completo con hora
 * @param date - La fecha a formatear
 * @returns Fecha y hora formateadas
 */
export function formatDateTime(date: Date | number): string {
	const dateObj = typeof date === 'number' ? new Date(date) : date;

	return dateObj.toLocaleString('es-ES', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

export function formatDate(timestamp: number, includeSeconds = false): string {
	if (!timestamp) return '-';

	const options: Intl.DateTimeFormatOptions = {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	};

	if (includeSeconds) {
		options.second = '2-digit';
	}

	return new Date(timestamp).toLocaleString(undefined, options);
}
