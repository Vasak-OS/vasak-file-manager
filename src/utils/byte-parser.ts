export function formatBytes(bytes: number, decimals?: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** unitIndex;
	return `${value.toFixed(decimals ?? (unitIndex > 0 ? 1 : 0))} ${units[unitIndex]}`;
}

/**
 * Tiempo restante estimado, compacto. Como `formatBytes`, sin palabras que
 * traducir: `h`/`min`/`s` son iguales en español e inglés. El `~` dice que es
 * una estimación. Mínimo `~1 s` para no mostrar `~0 s` sobre el final.
 */
export function formatEta(seconds: number): string {
	const total = Math.max(1, Math.round(seconds));
	if (total < 60) return `~${total} s`;

	const minutes = Math.round(total / 60);
	if (minutes < 60) return `~${minutes} min`;

	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return restMinutes > 0 ? `~${hours} h ${restMinutes} min` : `~${hours} h`;
}

export default formatBytes;
export { formatBytes as toReadableBytes };
