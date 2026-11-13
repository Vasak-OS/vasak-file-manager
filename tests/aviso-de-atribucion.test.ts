import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// GPLv3 §5(d): el aviso legal de Sigma File Manager se muestra en una pantalla
// del programa. Que la clave exista en los dos idiomas y que Ajustes la dibuje.
type Locale = { about?: { title?: unknown; credit?: unknown } };

for (const idioma of ['en', 'es']) {
	describe(`aviso de atribución (${idioma})`, () => {
		const about = (
			Bun.YAML.parse(readFileSync(`src-tauri/locales/${idioma}.yml`, 'utf8')) as Locale
		).about;

		test('about.title y about.credit existen y no están vacíos', () => {
			for (const clave of ['title', 'credit'] as const) {
				const valor = about?.[clave];
				expect(typeof valor === 'string' && valor.trim().length > 0).toBe(true);
			}
		});

		test('about.credit nombra a Sigma File Manager y a su autor', () => {
			expect(String(about?.credit)).toContain('Sigma File Manager');
			expect(String(about?.credit)).toContain('Aleksey Hoffman');
		});
	});
}

describe('pantalla de Ajustes', () => {
	test('muestra el aviso de atribución (about.credit)', () => {
		expect(readFileSync('src/views/SettingsView.vue', 'utf8')).toContain("t('about.credit')");
	});
});
