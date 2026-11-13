// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

type EventListener<T extends Event = Event> = (event: T) => void;

export function useEventListener<T extends Event = Event>(
	target: EventTarget | null,
	event: string,
	handler: EventListener<T>,
	options?: AddEventListenerOptions
): void {
	if (!target) return;

	target.addEventListener(event, handler as EventListener, options);

	// Note: To remove the listener, you'll need to keep track of it separately
	// or use an effect cleanup if you're in a component context
}
