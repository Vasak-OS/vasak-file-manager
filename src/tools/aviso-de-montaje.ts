/**
 * Qué se le dice a la persona cuando montar una unidad no sale.
 *
 * Antes no se le decía nada: el error se mandaba a la consola y el clic parecía
 * no haber ocurrido. Con un disco cifrado eso pasaba **siempre**, porque montarlo
 * sin desbloquearlo no puede funcionar.
 *
 * El backend contesta con un código y no con un texto: los mensajes de `udisks2`
 * vienen en inglés y no son para mostrar. Acá se traduce ese código a la clave
 * del catálogo, y se decide cuál de ellos merece un cartel.
 */

/** Lo que devuelve `mount_drive` cuando falla. */
export interface FalloDeMontaje {
	codigo: string;
	detalle: string;
}

/** El cartel que hay que mostrar, ya resuelto a claves de traducción. */
export interface AvisoDeFallo {
	claveDelTitulo: string;
	detalle: string;
}

const CLAVES: Record<string, string> = {
	notAuthorized: 'drive.mountNotAuthorized',
	wrongPassphrase: 'drive.mountWrongPassphrase',
	failed: 'drive.mountFailed',
};

/**
 * Cerrar el diálogo de la contraseña es una respuesta, no un fallo.
 *
 * Un cartel de error ahí le dice a la persona que algo salió mal cuando lo que
 * pasó es que hizo exactamente lo que quería.
 */
const SILENCIOSO = 'cancelled';

function esFalloDeMontaje(valor: unknown): valor is FalloDeMontaje {
	return (
		typeof valor === 'object' &&
		valor !== null &&
		typeof (valor as FalloDeMontaje).codigo === 'string'
	);
}

/**
 * El cartel que corresponde a un fallo, o `null` si no va ninguno.
 *
 * Un error que no tiene la forma esperada —una excepción de Tauri, un backend
 * más viejo que devolvía texto— no se descarta: se muestra como fallo genérico
 * con lo que haya. Tragárselo sería volver al clic que no hace nada.
 */
export function avisoDeFallo(error: unknown): AvisoDeFallo | null {
	if (!esFalloDeMontaje(error)) {
		return {
			claveDelTitulo: CLAVES.failed,
			detalle: typeof error === 'string' ? error : String(error ?? ''),
		};
	}

	if (error.codigo === SILENCIOSO) {
		return null;
	}

	return {
		claveDelTitulo: CLAVES[error.codigo] ?? CLAVES.failed,
		detalle: error.detalle ?? '',
	};
}
