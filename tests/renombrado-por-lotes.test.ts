/**
 * Renombrado por lotes (#147): el cálculo de los nombres nuevos.
 *
 * `computeBatchRename` es puro, así que se prueba directo, sin montar nada. Es
 * lo mismo que corre la vista previa del diálogo, de modo que lo que se asegura
 * acá es lo que ve quien usa el sistema antes de aplicar.
 */

import { describe, expect, test } from 'bun:test';
import {
	type BatchRenamePattern,
	computeBatchRename,
	DEFAULT_BATCH_RENAME_PATTERN,
} from '@/utils/batch-rename';
import { archivo, carpeta } from './support/dir-entry';

/** El patrón por omisión con lo que la prueba quiera cambiar. */
const patron = (campos: Partial<BatchRenamePattern> = {}): BatchRenamePattern => ({
	...DEFAULT_BATCH_RENAME_PATTERN,
	...campos,
});

/** Los nombres nuevos de un lote con un solo archivo. */
const nuevo = (name: string, campos: Partial<BatchRenamePattern>) =>
	computeBatchRename([archivo(name)], patron(campos))[0].newName;

describe('el patrón por omisión', () => {
	test('no cambia nada: cada entrada conserva su nombre y no hay errores', () => {
		const entradas = [archivo('a.txt'), carpeta('docs'), archivo('.bashrc')];

		const filas = computeBatchRename(entradas, DEFAULT_BATCH_RENAME_PATTERN);

		expect(filas.map((fila) => fila.newName)).toEqual(['a.txt', 'docs', '.bashrc']);
		for (const fila of filas) expect(fila.error).toBeUndefined();
	});

	test('arranca la numeración en 1 y sin relleno', () => {
		expect(DEFAULT_BATCH_RENAME_PATTERN).toEqual({
			find: '',
			replace: '',
			template: '',
			caseMode: 'none',
			startAt: 1,
			padding: 1,
		});
	});

	test('un lote vacío da un resultado vacío', () => {
		expect(computeBatchRename([], DEFAULT_BATCH_RENAME_PATTERN)).toEqual([]);
	});

	test('cada fila guarda la entrada original, su nombre viejo y respeta el orden', () => {
		const a = archivo('a.txt');
		const b = archivo('b.txt');

		const filas = computeBatchRename([b, a], patron({ find: '.txt', replace: '.md' }));

		expect(filas[0].entry).toBe(b);
		expect(filas[0].oldName).toBe('b.txt');
		expect(filas[0].newName).toBe('b.md');
		expect(filas[1].entry).toBe(a);
		expect(filas[1].oldName).toBe('a.txt');
		// No toca la entrada original.
		expect(a.name).toBe('a.txt');
	});
});

describe('buscar y reemplazar', () => {
	test('reemplaza todas las apariciones', () => {
		expect(nuevo('a-a-a.txt', { find: 'a', replace: 'x' })).toBe('x-x-x.txt');
	});

	test('es literal: el punto no es un comodín', () => {
		expect(nuevo('a.b.txt', { find: '.', replace: '_' })).toBe('a_b_txt');
		expect(nuevo('axb', { find: '.', replace: '_' })).toBe('axb');
	});

	test('los caracteres especiales de una regex se buscan tal cual', () => {
		expect(nuevo('foto (1).jpg', { find: ' (1)', replace: '' })).toBe('foto.jpg');
		expect(nuevo('a+b.txt', { find: '+', replace: '-' })).toBe('a-b.txt');
	});

	test('el reemplazo no interpreta `$&` ni `$1`', () => {
		expect(nuevo('a.txt', { find: 'a', replace: '$&$1' })).toBe('$&$1.txt');
	});

	test('distingue mayúsculas de minúsculas', () => {
		expect(nuevo('Foto.jpg', { find: 'foto', replace: 'x' })).toBe('Foto.jpg');
	});

	test('sin texto a buscar no reemplaza aunque haya reemplazo', () => {
		expect(nuevo('a.txt', { find: '', replace: 'zzz' })).toBe('a.txt');
	});

	test('un reemplazo vacío borra lo encontrado', () => {
		expect(nuevo('copia de a.txt', { find: 'copia de ', replace: '' })).toBe('a.txt');
	});

	test('también puede tocar la extensión', () => {
		expect(nuevo('foto.jpg', { find: '.jpg', replace: '.png' })).toBe('foto.png');
	});
});

describe('la plantilla', () => {
	test('{name} es el nombre sin extensión y {ext} la extensión con punto', () => {
		expect(nuevo('foto.jpg', { template: '{name}_nuevo{ext}' })).toBe('foto_nuevo.jpg');
	});

	test('sin {ext} en la plantilla la extensión se pierde: lo decide quien escribe', () => {
		expect(nuevo('foto.jpg', { template: '{name}' })).toBe('foto');
	});

	test('parte en el último punto', () => {
		expect(nuevo('copia.tar.gz', { template: '{name}|{ext}' })).toBe('copia.tar|.gz');
	});

	test('una carpeta no tiene extensión aunque lleve un punto', () => {
		const [fila] = computeBatchRename(
			[carpeta('proyecto.v2')],
			patron({ template: '{name}-{ext}' })
		);
		expect(fila.newName).toBe('proyecto.v2-');
	});

	test('un archivo oculto no tiene extensión: el punto inicial es parte del nombre', () => {
		expect(nuevo('.bashrc', { template: '{name}|{ext}' })).toBe('.bashrc|');
	});

	test('un archivo sin extensión deja {ext} vacío', () => {
		expect(nuevo('LEEME', { template: '{name}_1{ext}' })).toBe('LEEME_1');
	});

	test('un oculto con extensión parte en el último punto', () => {
		expect(nuevo('.config.json', { template: '{name}|{ext}' })).toBe('.config|.json');
	});

	test('un token repetido se expande cada vez', () => {
		expect(nuevo('a.txt', { template: '{n}-{n}{ext}' })).toBe('1-1.txt');
		expect(nuevo('a.txt', { template: '{name}{name}{ext}' })).toBe('aa.txt');
	});

	test('un token desconocido queda tal cual', () => {
		expect(nuevo('a.txt', { template: '{foo}{name}{N}{ext}' })).toBe('{foo}a{N}.txt');
	});

	test('una plantilla sin tokens da el mismo nombre a todas las entradas', () => {
		const filas = computeBatchRename(
			[archivo('a.txt'), archivo('b.txt')],
			patron({ template: 'fijo' })
		);
		expect(filas.map((fila) => fila.newName)).toEqual(['fijo', 'fijo']);
	});

	test('{name} es el nombre ya reemplazado, no el original', () => {
		expect(nuevo('foto.jpg', { find: 'foto', replace: 'img', template: '{name}_{n}{ext}' })).toBe(
			'img_1.jpg'
		);
	});

	test('la extensión sale después de reemplazar', () => {
		expect(nuevo('foto.jpg', { find: 'jpg', replace: 'png', template: '{name}{ext}' })).toBe(
			'foto.png'
		);
	});

	test('lo insertado por el reemplazo no se vuelve a expandir', () => {
		// El reemplazo mete «{n}» en el nombre: es texto, no un token.
		expect(nuevo('foto.jpg', { find: 'foto', replace: '{n}', template: '{name}{ext}' })).toBe(
			'{n}.jpg'
		);
	});

	test('un token dentro del nombre original tampoco se expande', () => {
		expect(nuevo('{ext}.txt', { template: '{name}{ext}' })).toBe('{ext}.txt');
	});
});

describe('la numeración {n}', () => {
	const tres = () => [archivo('a.jpg'), archivo('b.jpg'), archivo('c.jpg')];
	const numeros = (campos: Partial<BatchRenamePattern>) =>
		computeBatchRename(tres(), patron({ template: '{n}', ...campos })).map((fila) => fila.newName);

	test('cuenta desde startAt, una por entrada y en el orden recibido', () => {
		expect(numeros({ startAt: 1 })).toEqual(['1', '2', '3']);
		expect(numeros({ startAt: 10 })).toEqual(['10', '11', '12']);
		expect(numeros({ startAt: 0 })).toEqual(['0', '1', '2']);
	});

	test('rellena con ceros a la izquierda hasta `padding` dígitos', () => {
		expect(numeros({ startAt: 5, padding: 3 })).toEqual(['005', '006', '007']);
	});

	test('el relleno no recorta un número más largo', () => {
		expect(numeros({ startAt: 99, padding: 2 })).toEqual(['99', '100', '101']);
	});

	test('sin relleno (0) no agrega ceros', () => {
		expect(numeros({ startAt: 7, padding: 0 })).toEqual(['7', '8', '9']);
	});

	test('el relleno se acota a 20 dígitos', () => {
		expect(numeros({ startAt: 1, padding: 500 })[0]).toBe(`${'0'.repeat(19)}1`);
	});

	test('un relleno negativo o que no es un número vale cero', () => {
		expect(numeros({ startAt: 1, padding: -4 })[0]).toBe('1');
		expect(numeros({ startAt: 1, padding: Number.NaN })[0]).toBe('1');
		expect(numeros({ startAt: 1, padding: Number.POSITIVE_INFINITY })[0]).toBe('1');
	});

	test('un valor inicial negativo o que no es un número vale cero', () => {
		expect(numeros({ startAt: -5 })).toEqual(['0', '1', '2']);
		expect(numeros({ startAt: Number.NaN })).toEqual(['0', '1', '2']);
		expect(numeros({ startAt: Number.NEGATIVE_INFINITY })).toEqual(['0', '1', '2']);
	});

	test('los decimales se truncan', () => {
		expect(numeros({ startAt: 2.9, padding: 2.9 })).toEqual(['02', '03', '04']);
	});

	test('se combina con nombre y extensión', () => {
		const filas = computeBatchRename(
			[archivo('IMG_9.jpg'), archivo('IMG_3.jpg')],
			patron({ template: 'viaje-{n}{ext}', startAt: 1, padding: 3 })
		);
		expect(filas.map((fila) => fila.newName)).toEqual(['viaje-001.jpg', 'viaje-002.jpg']);
	});
});

describe('mayúsculas y minúsculas', () => {
	test('pasa todo a mayúsculas, extensión incluida', () => {
		expect(nuevo('Foto.jpg', { caseMode: 'upper' })).toBe('FOTO.JPG');
	});

	test('pasa todo a minúsculas', () => {
		expect(nuevo('FOTO.JPG', { caseMode: 'lower' })).toBe('foto.jpg');
	});

	test('«none» no toca las mayúsculas', () => {
		expect(nuevo('FoTo.JpG', { caseMode: 'none' })).toBe('FoTo.JpG');
	});

	test('se aplica al final, también sobre lo que puso la plantilla y el reemplazo', () => {
		expect(
			nuevo('a.txt', { find: 'a', replace: 'Hola', template: 'Mi_{name}{ext}', caseMode: 'upper' })
		).toBe('MI_HOLA.TXT');
		expect(nuevo('a.txt', { template: 'Mi_{name}{ext}', caseMode: 'lower' })).toBe('mi_a.txt');
	});

	test('un cambio sólo de mayúsculas no es una colisión con el propio nombre', () => {
		const [fila] = computeBatchRename(
			[archivo('foto.jpg')],
			patron({ caseMode: 'upper' }),
			new Set(['foto.jpg'])
		);
		expect(fila.newName).toBe('FOTO.JPG');
		expect(fila.error).toBeUndefined();
	});
});

describe('los espacios de los bordes', () => {
	test('se recortan al final de todo', () => {
		expect(nuevo('a.txt', { template: '  {name}{ext}  ' })).toBe('a.txt');
		expect(nuevo('a.txt', { find: '.txt', replace: '.txt ' })).toBe('a.txt');
		expect(nuevo('a.txt', { find: 'a', replace: '  a' })).toBe('a.txt');
	});

	test('los de adentro se conservan', () => {
		expect(nuevo('a.txt', { template: 'mi {name}{ext}' })).toBe('mi a.txt');
	});

	test('una plantilla de sólo espacios queda vacía', () => {
		const [fila] = computeBatchRename([archivo('a.txt')], patron({ template: '   ' }));
		expect(fila.newName).toBe('');
		expect(fila.error).toBe('empty');
	});
});

describe('nombres que no cambian', () => {
	test('un patrón que no encuentra nada deja el nombre igual y sin error', () => {
		const [fila] = computeBatchRename(
			[archivo('a.txt')],
			patron({ find: 'zzz', replace: 'x' }),
			new Set(['a.txt'])
		);
		expect(fila.newName).toBe(fila.oldName);
		expect(fila.error).toBeUndefined();
	});

	test('una plantilla que reconstruye el nombre tampoco es colisión con sí mismo', () => {
		const [fila] = computeBatchRename(
			[archivo('a.txt')],
			patron({ template: '{name}{ext}' }),
			new Set(['a.txt'])
		);
		expect(fila.newName).toBe('a.txt');
		expect(fila.error).toBeUndefined();
	});
});

describe('errores', () => {
	describe('vacío', () => {
		test('un nombre que queda vacío es «empty»', () => {
			const [fila] = computeBatchRename([archivo('a.txt')], patron({ find: 'a.txt', replace: '' }));
			expect(fila.newName).toBe('');
			expect(fila.error).toBe('empty');
		});

		test('una plantilla con sólo {ext} sobre un archivo sin extensión queda vacía', () => {
			const [fila] = computeBatchRename([archivo('LEEME')], patron({ template: '{ext}' }));
			expect(fila.error).toBe('empty');
		});

		test('un nombre vacío no se mira por colisión: dos vacíos son «empty», no «collision»', () => {
			const filas = computeBatchRename(
				[archivo('a.txt'), archivo('b.txt')],
				patron({ template: ' ' }),
				new Set([''])
			);
			expect(filas.map((fila) => fila.error)).toEqual(['empty', 'empty']);
		});

		test('lo que queda vacío se marca y el resto del lote sigue sin error', () => {
			const filas = computeBatchRename(
				[archivo('a'), archivo('b')],
				patron({ find: 'a', replace: '' })
			);
			expect(filas.map((fila) => fila.error)).toEqual(['empty', undefined]);
		});
	});

	describe('inválido', () => {
		test.each(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])(
			'rechaza el carácter «%s»',
			(caracter) => {
				const [fila] = computeBatchRename(
					[archivo('a.txt')],
					patron({ find: 'a', replace: `x${caracter}y` })
				);
				expect(fila.error).toBe('invalid');
			}
		);

		test('rechaza los caracteres de control', () => {
			expect(
				computeBatchRename([archivo('a.txt')], patron({ find: 'a', replace: 'x\u0000y' }))[0].error
			).toBe('invalid');
			expect(
				computeBatchRename([archivo('a.txt')], patron({ find: 'a', replace: 'x\u001Fy' }))[0].error
			).toBe('invalid');
			expect(
				computeBatchRename([archivo('a.txt')], patron({ find: 'a', replace: 'x\ny' }))[0].error
			).toBe('invalid');
		});

		test('un salto de línea en el borde se recorta y no invalida', () => {
			const [fila] = computeBatchRename(
				[archivo('a.txt')],
				patron({ find: '.txt', replace: '\n' })
			);
			expect(fila.newName).toBe('a');
			expect(fila.error).toBeUndefined();
		});

		test('«.» y «..» son inválidos', () => {
			expect(computeBatchRename([archivo('a')], patron({ find: 'a', replace: '.' }))[0].error).toBe(
				'invalid'
			);
			expect(
				computeBatchRename([archivo('a')], patron({ find: 'a', replace: '..' }))[0].error
			).toBe('invalid');
		});

		test('«...» y los nombres que empiezan con punto son válidos', () => {
			expect(
				computeBatchRename([archivo('a')], patron({ find: 'a', replace: '...' }))[0].error
			).toBeUndefined();
			expect(
				computeBatchRename([archivo('a')], patron({ find: 'a', replace: '.oculto' }))[0].error
			).toBeUndefined();
		});

		test('una barra que se cuela por la plantilla también es inválida', () => {
			const [fila] = computeBatchRename([archivo('a.txt')], patron({ template: '../{name}{ext}' }));
			expect(fila.error).toBe('invalid');
		});

		test('un nombre inválido no se mira por colisión', () => {
			const filas = computeBatchRename(
				[archivo('a.txt'), archivo('b.txt')],
				patron({ template: 'x:y' }),
				new Set(['x:y'])
			);
			expect(filas.map((fila) => fila.error)).toEqual(['invalid', 'invalid']);
		});
	});

	describe('colisión', () => {
		test('dos entradas que quedan con el mismo nombre chocan las dos', () => {
			const filas = computeBatchRename(
				[archivo('a.txt'), archivo('b.txt')],
				patron({ template: 'x{ext}' })
			);
			expect(filas.map((fila) => fila.newName)).toEqual(['x.txt', 'x.txt']);
			expect(filas.map((fila) => fila.error)).toEqual(['collision', 'collision']);
		});

		test('sólo chocan las que comparten destino: las demás quedan sin error', () => {
			const filas = computeBatchRename(
				[archivo('a.txt'), archivo('b.txt'), archivo('c.md')],
				patron({ find: 'b', replace: 'a' })
			);
			expect(filas.map((fila) => [fila.newName, fila.error])).toEqual([
				['a.txt', 'collision'],
				['a.txt', 'collision'],
				['c.md', undefined],
			]);
		});

		test('el mismo nombre en carpetas distintas no choca', () => {
			const filas = computeBatchRename(
				[
					archivo('a.txt', { path: '/casa/uno/a.txt' }),
					archivo('b.txt', { path: '/casa/dos/b.txt' }),
				],
				patron({ template: 'x{ext}' })
			);
			for (const fila of filas) expect(fila.error).toBeUndefined();
		});

		test('chocar con un nombre que ya hay en la carpeta es colisión', () => {
			const [fila] = computeBatchRename(
				[archivo('a.txt')],
				patron({ find: 'a', replace: 'b' }),
				new Set(['a.txt', 'b.txt'])
			);
			expect(fila.newName).toBe('b.txt');
			expect(fila.error).toBe('collision');
		});

		test('un nombre libre en la carpeta no choca', () => {
			const [fila] = computeBatchRename(
				[archivo('a.txt')],
				patron({ find: 'a', replace: 'c' }),
				new Set(['a.txt', 'b.txt'])
			);
			expect(fila.error).toBeUndefined();
		});

		test('sin `existingNames` sólo se miran los choques del lote', () => {
			const [fila] = computeBatchRename([archivo('a.txt')], patron({ find: 'a', replace: 'b' }));
			expect(fila.error).toBeUndefined();
		});

		test('chocar con el propio nombre no cuenta', () => {
			const [fila] = computeBatchRename(
				[archivo('a.txt')],
				patron({ template: '{name}{ext}' }),
				new Set(['a.txt'])
			);
			expect(fila.error).toBeUndefined();
		});

		test('con la numeración, cada entrada recibe un nombre distinto y no choca', () => {
			const filas = computeBatchRename(
				[archivo('a.txt'), archivo('b.txt'), archivo('c.txt')],
				patron({ template: 'foto-{n}{ext}' })
			);
			expect(filas.map((fila) => fila.error)).toEqual([undefined, undefined, undefined]);
		});
	});
});
