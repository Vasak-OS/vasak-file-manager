// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

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
