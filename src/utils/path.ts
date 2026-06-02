export function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string | null {
	if (path === oldPrefix) return newPrefix;
	if (path.startsWith(`${oldPrefix}/`)) return newPrefix + path.slice(oldPrefix.length);
	return null;
}
