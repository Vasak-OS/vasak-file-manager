// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

type AnyFn = (...args: any[]) => void;

type DebouncedFn<T extends AnyFn> = ((...args: Parameters<T>) => void) & {
	cancel: () => void;
	flush: () => void;
};

export function useDebounceFn<T extends AnyFn>(fn: T, delayMs = 200): DebouncedFn<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: Parameters<T> | null = null;

	const debounced = (...args: Parameters<T>) => {
		lastArgs = args;

		if (timer) {
			clearTimeout(timer);
		}

		timer = setTimeout(() => {
			timer = null;

			if (lastArgs) {
				fn(...lastArgs);
			}
		}, delayMs);
	};

	debounced.cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};

	debounced.flush = () => {
		if (!timer || !lastArgs) {
			return;
		}

		clearTimeout(timer);
		timer = null;
		fn(...lastArgs);
	};

	return debounced;
}
