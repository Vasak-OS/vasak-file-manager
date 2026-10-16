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

/**
 * Los formateadores de `formatDate`, armados una sola vez.
 *
 * `toLocaleString(undefined, options)` construye un `Intl.DateTimeFormat` nuevo
 * por llamada, y esto se llama por celda de la columna «modificado» de la vista
 * de lista: con una carpeta grande son cientos de formateadores por dibujado,
 * todos iguales. Son dos variantes —con segundos y sin—, así que van dos.
 *
 * El locale sigue siendo el del entorno: `undefined` y no un código fijo, que
 * cambiaría la salida. `Intl.DateTimeFormat` guarda el idioma que resolvió
 * `undefined` en ese momento, que es exactamente lo que hacía
 * `toLocaleString(undefined, …)` llamada por llamada.
 */
const cachedDateFormatters = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(includeSeconds: boolean): Intl.DateTimeFormat {
	const key = includeSeconds ? 'seconds' : 'minutes';
	const cached = cachedDateFormatters.get(key);

	if (cached) return cached;

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

	const formatter = new Intl.DateTimeFormat(undefined, options);
	cachedDateFormatters.set(key, formatter);

	return formatter;
}

export function formatDate(timestamp: number, includeSeconds = false): string {
	if (!timestamp) return '-';

	return getDateFormatter(includeSeconds).format(new Date(timestamp));
}

export interface RelativeTimeTranslations {
	justNow: string;
	minutesAgo: (count: number) => string;
	hoursAgo: (count: number) => string;
	daysAgo: (count: number) => string;
}

export function formatRelativeTime(
	timestamp: number,
	translations: RelativeTimeTranslations
): string {
	const now = Date.now();
	const diff = now - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return translations.justNow;
	if (minutes < 60) return translations.minutesAgo(minutes);
	if (hours < 24) return translations.hoursAgo(hours);
	if (days < 7) return translations.daysAgo(days);

	return new Date(timestamp).toLocaleDateString();
}
