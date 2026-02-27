export default function toReadableBytes(bytes: number, decimals?: number): string {
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
	const base = 1024;
	const exp = Math.floor(Math.log(bytes) / Math.log(base));
	const value = bytes / base ** exp;
	const precision = exp > 0 ? (decimals ?? 1) : 0;
	return `${value.toFixed(precision)} ${units[exp]}`;
}

export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** unitIndex;
	return `${value.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}
