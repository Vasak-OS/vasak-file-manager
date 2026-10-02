/**
 * Los colores de las etiquetas.
 *
 * Son **datos**, no colores dibujados: el color de una etiqueta lo elige la
 * persona (o lo sortea el gestor al crearla), se guarda con la etiqueta en
 * `user-stats.json` y viaja con ella. Por eso no salen del esquema: una
 * etiqueta roja tiene que seguir siendo roja con cualquier tema. Es la única
 * excepción de colores de la guardia del diseño (`tests/design-guard.test.ts`,
 * §5 del inventario de vue-libvasak#74), y vive sola en este archivo para que
 * la excepción no tape nada más.
 *
 * Se pintan siempre a través de `Badge color` / `StatusDot color`, que los usan
 * para el punto y el canto y dejan el texto en el color del esquema.
 */

/** La paleta de la que se sortea el color de una etiqueta nueva. */
export const TAG_COLORS: readonly string[] = [
	'#ef4444',
	'#f97316',
	'#eab308',
	'#22c55e',
	'#14b8a6',
	'#3b82f6',
	'#8b5cf6',
	'#ec4899',
];

/** Los colores de las cuatro etiquetas que trae un perfil nuevo. */
export const DEFAULT_TAG_COLORS = {
	important: '#ef4444',
	work: '#3b82f6',
	personal: '#22c55e',
	archive: '#a855f7',
} as const;

/** Un color de la paleta, al azar. */
export function randomTagColor(random: () => number = Math.random): string {
	return TAG_COLORS[Math.floor(random() * TAG_COLORS.length)] as string;
}
