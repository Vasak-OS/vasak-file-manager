export default function clone<T>(item: T): T {
	if (item === null || typeof item !== 'object') {
		return item;
	}

	if (Array.isArray(item)) {
		return item.map(clone) as unknown as T;
	}

	const result: Record<string, unknown> = {};
	for (const key of Object.keys(item)) {
		result[key] = clone((item as Record<string, unknown>)[key]);
	}
	return result as T;
}
