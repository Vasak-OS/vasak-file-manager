// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

/** El último segmento de una ruta, para mostrarla sin la carpeta entera. */
export function basename(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	return trimmed.slice(trimmed.lastIndexOf('/') + 1) || path;
}

export function replacePathPrefix(
	path: string,
	oldPrefix: string,
	newPrefix: string
): string | null {
	if (path === oldPrefix) return newPrefix;
	if (path.startsWith(`${oldPrefix}/`)) return newPrefix + path.slice(oldPrefix.length);
	return null;
}
