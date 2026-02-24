export default function toReadableBytes(bytes: number, decimals?: number): string {
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
	const base = 1024;
	const exp = Math.floor(Math.log(bytes) / Math.log(base));
	const value = bytes / base ** exp;
	const precision = exp > 0 ? (decimals ?? 1) : 0;
	return `${value.toFixed(precision)} ${units[exp]}`;
}
