import type { DirEntry } from '@/types/dir-entry';

/** Factory de `DirEntry` para las pruebas, con los defaults de un archivo común. */
export function makeDirEntry(campos: Partial<DirEntry> & { name: string }): DirEntry {
	return {
		name: campos.name,
		path: campos.path ?? `/casa/${campos.name}`,
		ext: null,
		size: 0,
		item_count: null,
		modified_time: 0,
		accessed_time: 0,
		created_time: 0,
		mime: null,
		is_file: true,
		is_dir: false,
		is_symlink: false,
		is_hidden: false,
		...campos,
	};
}

export const carpeta = (name: string, campos: Partial<DirEntry> = {}): DirEntry =>
	makeDirEntry({ name, is_file: false, is_dir: true, ...campos });

export const archivo = (name: string, campos: Partial<DirEntry> = {}): DirEntry =>
	makeDirEntry({ name, is_file: true, is_dir: false, ...campos });

export const nombres = (entradas: DirEntry[]): string[] => entradas.map((una) => una.name);
