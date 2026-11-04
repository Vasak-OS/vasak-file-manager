/** `formatEta`: tiempo restante compacto, sin palabras que traducir (#179). */

import { describe, expect, test } from 'bun:test';
import { formatEta } from '@/utils/byte-parser';

describe('formatEta', () => {
	test('menos de un minuto va en segundos, con mínimo de 1', () => {
		expect(formatEta(0)).toBe('~1 s');
		expect(formatEta(0.4)).toBe('~1 s');
		expect(formatEta(1.4)).toBe('~1 s');
		expect(formatEta(1.6)).toBe('~2 s');
		expect(formatEta(45)).toBe('~45 s');
		expect(formatEta(59)).toBe('~59 s');
	});

	test('un valor negativo no muestra segundos negativos', () => {
		expect(formatEta(-5)).toBe('~1 s');
	});

	test('de 60 s a una hora va en minutos redondeados', () => {
		expect(formatEta(59.5)).toBe('~1 min');
		expect(formatEta(60)).toBe('~1 min');
		expect(formatEta(89)).toBe('~1 min');
		expect(formatEta(90)).toBe('~2 min');
		expect(formatEta(150)).toBe('~3 min');
		expect(formatEta(3000)).toBe('~50 min');
	});

	test('el borde de la hora nunca muestra 60 min: pasa a ~1 h', () => {
		expect(formatEta(3569)).toBe('~59 min');
		expect(formatEta(3570)).toBe('~1 h');
		expect(formatEta(3599)).toBe('~1 h');
	});

	test('desde una hora va en horas, con minutos si sobran', () => {
		expect(formatEta(3600)).toBe('~1 h');
		expect(formatEta(3600 + 300)).toBe('~1 h 5 min');
		expect(formatEta(3600 + 29 * 60)).toBe('~1 h 29 min');
		expect(formatEta(7200)).toBe('~2 h');
		expect(formatEta(7200 + 90)).toBe('~2 h 2 min');
		expect(formatEta(36000)).toBe('~10 h');
	});

	test('los minutos que redondean a la hora siguiente la suman', () => {
		// 3600 + 30 s redondea a 61 min -> 1 h 1 min; 7170 s son 120 min -> 2 h.
		expect(formatEta(3630)).toBe('~1 h 1 min');
		expect(formatEta(7170)).toBe('~2 h');
	});
});
