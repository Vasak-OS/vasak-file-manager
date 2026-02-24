function disableContextMenu() {
	document.addEventListener('contextmenu', (event) => {
		event.preventDefault();
	});
}

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
	disableContextMenu();
	disableNativeFind();
}
