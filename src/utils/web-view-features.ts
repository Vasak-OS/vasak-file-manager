// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

/**
 * Lo que hace el motor del navegador por su cuenta y no corresponde en una
 * aplicación del escritorio.
 *
 * El menú del clic derecho ya no está acá: lo apaga el menú contextual de
 * VasakOS desde `setupContextMenu`, que además es el que dibuja el que sí
 * corresponde.
 *
 * Queda la búsqueda de WebKit, que busca texto en el HTML de la ventana: en una
 * lista de archivos que se dibuja por tramos encuentra sólo lo que está a la
 * vista, y el resultado parece una búsqueda que se perdió archivos.
 */
function disableNativeFind() {
	document.addEventListener(
		'keydown',
		(event) => {
			const isCtrlOrCmd = event.ctrlKey || event.metaKey;

			// Con Mayúsculas o Bloq Mayús `key` llega como 'F': sin pasarlo a
			// minúscula la búsqueda del navegador se colaba. F3 y Ctrl+G son su
			// «buscar siguiente».
			const key = event.key.toLowerCase();

			if ((isCtrlOrCmd && (key === 'f' || key === 'g')) || key === 'f3') {
				event.preventDefault();
			}
		},
		{ capture: true }
	);
}

export function disableWebViewFeatures() {
	disableNativeFind();
}
