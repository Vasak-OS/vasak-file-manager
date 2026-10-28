/**
 * Renombrado por lotes: calcula el nombre nuevo de cada entrada a partir de un
 * patrón. Es una función pura —sin I/O ni Vue— para que la vista previa del
 * diálogo y las pruebas usen exactamente la misma lógica.
 */

import type { DirEntry } from '@/types/dir-entry';

export type BatchRenameCase = 'none' | 'upper' | 'lower';

export interface BatchRenamePattern {
	/** Texto a buscar (literal, no regex). Vacío: no se busca nada. */
	find: string;
	/** Con qué se reemplaza cada aparición de `find`. */
	replace: string;
	/** Plantilla con `{name}`, `{ext}` y `{n}`. Vacía: se conserva el nombre. */
	template: string;
	caseMode: BatchRenameCase;
	/** Primer valor de `{n}`. */
	startAt: number;
	/** Cantidad mínima de dígitos de `{n}`, con ceros a la izquierda. */
	padding: number;
}

export type BatchRenameError = 'empty' | 'invalid' | 'collision';

export interface BatchRenameRow {
	entry: DirEntry;
	oldName: string;
	newName: string;
	error?: BatchRenameError;
}

export const DEFAULT_BATCH_RENAME_PATTERN: BatchRenamePattern = {
	find: '',
	replace: '',
	template: '',
	caseMode: 'none',
	startAt: 1,
	padding: 1,
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: se rechazan a propósito los caracteres de control
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001F]/;

/** Un número entero finito dentro de [0, max]; lo que no lo es, vale 0. */
function toSafeInt(value: number, max: number): number {
	return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), max) : 0;
}

/** Separa nombre y extensión (con punto). Carpetas y archivos ocultos no tienen. */
function splitExtension(name: string, isDir: boolean): [string, string] {
	const dot = name.lastIndexOf('.');
	if (isDir || dot <= 0) return [name, ''];
	return [name.slice(0, dot), name.slice(dot)];
}

function parentOf(path: string): string {
	return path.slice(0, path.lastIndexOf('/'));
}

function buildName(entry: DirEntry, index: number, pattern: BatchRenamePattern): string {
	let name = entry.name;

	// `split/join` y no `replace`: es literal y no interpreta `$&` del reemplazo.
	if (pattern.find !== '') {
		name = name.split(pattern.find).join(pattern.replace);
	}

	if (pattern.template !== '') {
		const [base, ext] = splitExtension(name, entry.is_dir);
		const counter = String(toSafeInt(pattern.startAt, Number.MAX_SAFE_INTEGER) + index).padStart(
			toSafeInt(pattern.padding, 20),
			'0'
		);
		// Una sola pasada con función: lo que se inserta no se vuelve a expandir.
		name = pattern.template.replace(/\{(name|ext|n)\}/g, (_, token: string) =>
			token === 'name' ? base : token === 'ext' ? ext : counter
		);
	}

	if (pattern.caseMode === 'upper') name = name.toUpperCase();
	else if (pattern.caseMode === 'lower') name = name.toLowerCase();

	return name.trim();
}

/**
 * Calcula el nombre nuevo de cada entrada, en el orden recibido (el índice
 * alimenta `{n}`).
 *
 * `existingNames` son los nombres que ya hay en la carpeta: chocar con uno que
 * no sea el nombre propio de la entrada es una colisión.
 */
export function computeBatchRename(
	entries: DirEntry[],
	pattern: BatchRenamePattern,
	existingNames?: Set<string>
): BatchRenameRow[] {
	const rows: BatchRenameRow[] = entries.map((entry, index) => ({
		entry,
		oldName: entry.name,
		newName: buildName(entry, index, pattern),
	}));

	// Cuántas entradas quedan con el mismo destino (misma carpeta + mismo nombre).
	const targets = new Map<string, number>();
	for (const row of rows) {
		const key = `${parentOf(row.entry.path)}/${row.newName}`;
		targets.set(key, (targets.get(key) ?? 0) + 1);
	}

	for (const row of rows) {
		if (row.newName === '') row.error = 'empty';
		else if (INVALID_CHARS.test(row.newName) || row.newName === '.' || row.newName === '..')
			row.error = 'invalid';
		else if (
			(targets.get(`${parentOf(row.entry.path)}/${row.newName}`) ?? 0) > 1 ||
			(existingNames?.has(row.newName) && row.newName !== row.oldName)
		)
			row.error = 'collision';
	}

	return rows;
}
