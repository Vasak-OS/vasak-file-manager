// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

type Fn = () => void;

interface TimeoutFnReturn {
	start: () => void;
	stop: () => void;
}

export function useTimeoutFn(
	fn: Fn,
	delayMs = 200,
	options?: { immediate?: boolean }
): TimeoutFnReturn {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const start = () => {
		if (timer) {
			clearTimeout(timer);
		}

		timer = setTimeout(() => {
			timer = null;
			fn();
		}, delayMs);
	};

	const stop = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};

	if (options?.immediate) {
		fn();
	}

	return {
		start,
		stop,
	};
}
