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

			if (isCtrlOrCmd && event.key === 'f') {
				event.preventDefault();
			}
		},
		{ capture: true }
	);
}

export function disableWebViewFeatures() {
	disableNativeFind();
}
