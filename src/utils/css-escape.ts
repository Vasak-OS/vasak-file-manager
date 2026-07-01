export function entryPathSelector(path: string): string {
  if (!path) return '';
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(path);
  }
  return path
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\a ')
    .replace(/\r/g, '\\d ');
}
