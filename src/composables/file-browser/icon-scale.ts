/**
 * La escala de los íconos y tarjetas, en niveles discretos.
 *
 * El zoom salta entre estos niveles —nunca a un valor intermedio— porque cada
 * nivel tiene un alto fijo: así los desplazadores virtuales (RecycleScroller,
 * DynamicScroller) no tienen que remedir tarjeta por tarjeta al hacer zoom.
 */
export const ICON_SCALE_LEVELS = [0.75, 1, 1.25, 1.5, 2] as const;

export const DEFAULT_ICON_SCALE = 1;

/** Ajusta un valor al nivel válido más cercano (datos viejos o fuera de rango). */
export function clampIconScale(scale: number): number {
	let best: number = ICON_SCALE_LEVELS[0];

	for (const level of ICON_SCALE_LEVELS) {
		if (Math.abs(level - scale) < Math.abs(best - scale)) {
			best = level;
		}
	}

	return best;
}

/** El nivel siguiente (`1`) o anterior (`-1`); se queda en el tope si no hay más. */
export function stepIconScale(scale: number, direction: 1 | -1): number {
	const current = clampIconScale(scale);
	const index = ICON_SCALE_LEVELS.indexOf(current as (typeof ICON_SCALE_LEVELS)[number]);
	const next = index + direction;

	if (next < 0 || next >= ICON_SCALE_LEVELS.length) {
		return current;
	}

	return ICON_SCALE_LEVELS[next];
}
