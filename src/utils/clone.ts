export default function clone<T>(item: T): T {
	return structuredClone(item);
}
