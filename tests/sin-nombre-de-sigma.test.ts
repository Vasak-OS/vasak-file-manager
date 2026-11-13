import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// El nombre de la aplicación es «Vasak File Manager»: que el literal del
// original (Sigma File Manager) no vuelva a una ventana o a un texto visible.
// La atribución a SFM vive en los encabezados y el README, sin ese literal.
const LITERAL = 'Sigma File Manager';

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'target' ? [] : sourceFiles(path);
		return /\.(ts|vue|rs|css)$/.test(entry.name) ? [path] : [];
	});
}

describe('nombre de la aplicación', () => {
	test('ningún archivo fuente nombra a Sigma File Manager', () => {
		const offenders = [...sourceFiles('src'), ...sourceFiles('src-tauri/src')].filter((file) =>
			readFileSync(file, 'utf8').includes(LITERAL)
		);
		expect(offenders).toEqual([]);
	});
});
