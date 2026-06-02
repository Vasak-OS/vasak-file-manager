export function formatBytes(bytes: number, decimals?: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** unitIndex;
	return `${value.toFixed(decimals ?? (unitIndex > 0 ? 1 : 0))} ${units[unitIndex]}`;
}

export default formatBytes;
export { formatBytes as toReadableBytes };

