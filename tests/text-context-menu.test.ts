import { describe, expect, test } from 'bun:test';
import {
	type CampoDeTexto,
	ejecutarAccion,
	esAccionDeTexto,
	type Portapapeles,
	TIPOS_CON_TEXTO,
} from '../src/components/ui/text-context-menu';

/**
 * Un campo de texto de mentira, con lo justo que usa el menú.
 *
 * Las pruebas miran una sola cosa: qué le queda escrito a quien usó el menú
 * cuando el portapapeles no colabora.
 */
function campoFalso(valor: string, desde: number, hasta: number): CampoDeTexto {
	return {
		value: valor,
		selectionStart: desde,
		selectionEnd: hasta,
		focus() {},
		select() {},
		setRangeText(texto: string, inicio: number, fin: number) {
			this.value = this.value.slice(0, inicio) + texto + this.value.slice(fin);
		},
		dispatchEvent() {
			return true;
		},
	} as unknown as CampoDeTexto;
}

function portapapelesFalso(opciones: {
	contenido?: string | null;
	escrituraFalla?: boolean;
	lecturaFalla?: boolean;
}): Portapapeles & { escrito: string[] } {
	const escrito: string[] = [];

	return {
		escrito,
		leer: async () => {
			if (opciones.lecturaFalla) throw new Error('el portapapeles no contesta');
			return opciones.contenido ?? null;
		},
		escribir: async (texto: string) => {
			if (opciones.escrituraFalla) throw new Error('el portapapeles no contesta');
			escrito.push(texto);
		},
	};
}

describe('cortar', () => {
	test('no borra la selección si el texto no llegó al portapapeles', async () => {
		const campo = campoFalso('hola mundo', 0, 4);
		const portapapeles = portapapelesFalso({ escrituraFalla: true });

		await ejecutarAccion('cortar', campo, 'hola', portapapeles);

		expect(campo.value).toBe('hola mundo');
		expect(portapapeles.escrito).toEqual([]);
	});

	test('borra la selección cuando la copia funcionó', async () => {
		const campo = campoFalso('hola mundo', 0, 5);
		const portapapeles = portapapelesFalso({});

		await ejecutarAccion('cortar', campo, 'hola ', portapapeles);

		expect(campo.value).toBe('mundo');
		expect(portapapeles.escrito).toEqual(['hola ']);
	});
});

describe('copiar', () => {
	test('deja el campo intacto aunque el portapapeles falle', async () => {
		const campo = campoFalso('hola mundo', 0, 4);

		await ejecutarAccion('copiar', campo, 'hola', portapapelesFalso({ escrituraFalla: true }));

		expect(campo.value).toBe('hola mundo');
	});
});

describe('pegar', () => {
	test('con el portapapeles vacío no borra lo seleccionado', async () => {
		const campo = campoFalso('hola mundo', 0, 4);

		await ejecutarAccion('pegar', campo, 'hola', portapapelesFalso({ contenido: null }));

		expect(campo.value).toBe('hola mundo');
	});

	test('con el portapapeles ilegible no borra lo seleccionado', async () => {
		const campo = campoFalso('hola mundo', 0, 4);

		await ejecutarAccion('pegar', campo, 'hola', portapapelesFalso({ lecturaFalla: true }));

		expect(campo.value).toBe('hola mundo');
	});

	test('reemplaza la selección cuando hay texto', async () => {
		const campo = campoFalso('hola mundo', 0, 4);

		await ejecutarAccion('pegar', campo, 'hola', portapapelesFalso({ contenido: 'chau' }));

		expect(campo.value).toBe('chau mundo');
	});
});

describe('los campos que aceptan el menú', () => {
	test('deja afuera los tipos donde la selección tira InvalidStateError', () => {
		expect(TIPOS_CON_TEXTO).not.toContain('number');
		expect(TIPOS_CON_TEXTO).not.toContain('email');
	});

	test('sigue cubriendo los campos de texto de siempre', () => {
		expect(TIPOS_CON_TEXTO).toContain('text');
		expect(TIPOS_CON_TEXTO).toContain('search');
		expect(TIPOS_CON_TEXTO).toContain('password');
	});
});

describe('esAccionDeTexto', () => {
	test('sólo reconoce lo que el menú sabe hacer', () => {
		expect(esAccionDeTexto('pegar')).toBe(true);
		expect(esAccionDeTexto('seleccionar-todo')).toBe(true);
		expect(esAccionDeTexto('formatear-el-disco')).toBe(false);
	});
});
