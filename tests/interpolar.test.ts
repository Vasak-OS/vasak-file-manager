import { describe, expect, test } from 'bun:test';
import { claveSegunCantidad, interpolar } from '@/tools/interpolar';

describe('interpolar', () => {
	test('reemplaza los marcadores por su valor', () => {
		expect(interpolar('Copiando {0} elementos', 3)).toBe('Copiando 3 elementos');
		expect(interpolar('De {0} a {1}', 'aquí', 'allá')).toBe('De aquí a allá');
	});

	test('un nombre de archivo con «$&» no se destroza', () => {
		// El caso real: `replace` interpreta `$&` en la cadena de reemplazo como
		// «lo que coincidió», o sea el propio marcador. Sin el ayudante, esto
		// devolvía «Copiando {0}».
		expect(interpolar('Copiando {0}', 'Rock $& Roll.mp3')).toBe('Copiando Rock $& Roll.mp3');
	});

	test("y con «$'» tampoco pierde el resto del texto", () => {
		// `$'` significa «lo que va después de la coincidencia», así que el texto
		// posterior se duplicaba o desaparecía.
		expect(interpolar('Copiando {0} a la carpeta', "cancion$'.mp3")).toBe(
			"Copiando cancion$'.mp3 a la carpeta"
		);
		expect(interpolar('Copiando {0}', 'a$`b')).toBe('Copiando a$`b');
		expect(interpolar('Copiando {0}', 'a$$b')).toBe('Copiando a$$b');
	});

	test('el mismo marcador repetido se reemplaza en todas sus apariciones', () => {
		expect(interpolar('{0} pesa lo mismo que {0}', 'esto')).toBe('esto pesa lo mismo que esto');
	});

	test('un marcador sin valor queda como está, en lugar de decir «undefined»', () => {
		expect(interpolar('Copiando {0} a {1}', 'algo')).toBe('Copiando algo a {1}');
	});
});

describe('claveSegunCantidad', () => {
	test('uno y varios usan claves distintas', () => {
		// Sin esto se muestra «1 elementos».
		expect(claveSegunCantidad('operations.copying', 1)).toBe('operations.copyingOne');
		expect(claveSegunCantidad('operations.copying', 2)).toBe('operations.copyingOther');
		expect(claveSegunCantidad('operations.copying', 0)).toBe('operations.copyingOther');
	});
});

describe('interpolar: una sola pasada', () => {
	test('un valor que contiene otro marcador no se vuelve a reemplazar', () => {
		// El bug: reemplazando marcador por marcador, el `{1}` que trae el primer
		// valor lo pisaba la pasada siguiente. En un gestor de archivos el valor es
		// un nombre que eligió la persona, así que puede contener cualquier cosa.
		expect(interpolar('Archivo: {0}', '{1}', 'x')).toBe('Archivo: {1}');
		expect(interpolar('{0} y {1}', '{1}', 'segundo')).toBe('{1} y segundo');
	});

	test('los marcadores fuera de orden se resuelven igual', () => {
		expect(interpolar('{1} antes de {0}', 'segundo', 'primero')).toBe('primero antes de segundo');
	});
});
