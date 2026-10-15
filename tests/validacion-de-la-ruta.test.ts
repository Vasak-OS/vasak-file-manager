/**
 * Cómo averigua el navegador si la carpeta actual sigue existiendo.
 *
 * El vigilante avisa de cambios: cuando el evento es de **la misma** ruta que
 * se está mirando, la carpeta puede haber cambiado de contenido y se refresca
 * en silencio con `silentRefresh` —que sí la lista—. Cuando es de **otra**
 * ruta, lo que puede haber pasado es que la carpeta actual se borrara o se
 * renombrara, y se valida con `validateCurrentPath`.
 *
 * `validateCurrentPath` hacía un `read_dir` entero —el `stat` de cada entrada—
 * sólo para saber si la ruta existe. Ahora pregunta con `path_exists`, que es
 * lo único que necesita saber; sigue navegando al ancestro existente más
 * cercano cuando la ruta ya no está, y también cuando la invocación falla, que
 * es el `catch` que se conservó a propósito.
 *
 * La prueba del reparto importa por un caso que `path_exists` ya no cubre: una
 * carpeta que existe pero **no se puede listar** —permisos—. `path_exists`
 * contesta `true`, así que por esa vía no se navega; el camino que sí la atiende
 * es `silentRefresh`, que es el que lee y atrapa el error. Fijar el reparto es
 * fijar que ese caso sigue teniendo quien lo maneje.
 *
 * `validateCurrentPath` no se exporta: se llega a ella por el evento del
 * vigilante, con el antirrebote de 500 ms andado con relojes falsos.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { useFileBrowserNavigation } from '@/composables/file-browser/use-file-browser-navigation';
import type { DirContents } from '@/types/dir-entry';
import type { Tab } from '@/types/workspaces';
import { emitir, invocaciones, olvidarTodo, pedidos, responder } from './dobles';

const CURRENT_PATH = '/casa/pato/proyecto/';
const ANCESTOR_PATH = '/casa/pato/';
const OTHER_PATH = '/otra/carpeta/';

const DEBOUNCE_MS = 500;

/** Un `read_dir` vacío, con la ruta normalizada como la devuelve el backend. */
function emptyContents(args: Record<string, unknown>): DirContents {
	const path = String(args.path);

	return {
		path: path.endsWith('/') ? path : `${path}/`,
		entries: [],
		total_count: 0,
		dir_count: 0,
		file_count: 0,
	};
}

let navigation: ReturnType<typeof useFileBrowserNavigation>;
let mounted: ReturnType<typeof mount> | null = null;

/** El navegador vivo, con un componente que lo aloja —usa `onUnmounted`—. */
function mountNavigation(): void {
	const tab = { path: CURRENT_PATH } as Tab;

	const host = defineComponent({
		setup() {
			navigation = useFileBrowserNavigation(() => tab);

			return () => h('div');
		},
	});

	mounted = mount(host);
}

/** Vacía la cola de microtareas: todo lo que cruza el IPC es una promesa. */
async function flushMicrotasks(): Promise<void> {
	for (let round = 0; round < 30; round++) {
		await Promise.resolve();
	}
}

async function openFolder(): Promise<void> {
	responder('read_dir', emptyContents);
	await navigation.init();
	await flushMicrotasks();
}

/** Dispara el aviso del vigilante y deja pasar el antirrebote. */
async function notifyChange(watchedPath: string) {
	const since = invocaciones.length;

	await emitir('dir-change', { watchedPath, changedPath: CURRENT_PATH, kind: 'modify' });
	jest.advanceTimersByTime(DEBOUNCE_MS);
	await flushMicrotasks();

	return invocaciones.slice(since);
}

beforeEach(() => {
	setActivePinia(createPinia());
	olvidarTodo();
	jest.useFakeTimers();
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
	jest.useRealTimers();
});

describe('validar que la carpeta actual siga existiendo', () => {
	test('pregunta si la ruta existe en vez de listarla entera', async () => {
		mountNavigation();
		await openFolder();
		responder('path_exists', true);

		const after = await notifyChange(OTHER_PATH);

		const questions = after.filter((invocation) => invocation.comando === 'path_exists');
		expect(questions).toHaveLength(1);
		expect(questions[0]?.argumentos).toEqual({ path: CURRENT_PATH });

		// Y ninguna lectura de la carpeta: para saber que existe no hace falta.
		expect(after.filter((invocation) => invocation.comando === 'read_dir')).toEqual([]);
	});

	test('si la ruta ya no existe, navega al ancestro existente más cercano', async () => {
		mountNavigation();
		await openFolder();
		responder('path_exists', false);

		await notifyChange(OTHER_PATH);

		expect(navigation.currentPath.value).toBe(ANCESTOR_PATH);
	});

	test('si la pregunta falla, también navega al ancestro: el `catch` se conservó', async () => {
		mountNavigation();
		await openFolder();
		responder('path_exists', () => {
			throw new Error('el puente se cayó');
		});

		await notifyChange(OTHER_PATH);

		expect(navigation.currentPath.value).toBe(ANCESTOR_PATH);
	});
});

describe('el reparto entre refrescar y validar', () => {
	test('un cambio en la misma ruta refresca en silencio: la lee, no pregunta si existe', async () => {
		mountNavigation();
		await openFolder();
		responder('path_exists', true);

		const after = await notifyChange(CURRENT_PATH);

		expect(pedidos('path_exists')).toHaveLength(0);
		expect(after.filter((invocation) => invocation.comando === 'read_dir')).toHaveLength(1);
	});

	test('un cambio en otra ruta valida la ruta actual: pregunta si existe, no la lee', async () => {
		mountNavigation();
		await openFolder();
		responder('path_exists', true);

		const after = await notifyChange(OTHER_PATH);

		expect(after.filter((invocation) => invocation.comando === 'path_exists')).toHaveLength(1);
		expect(after.filter((invocation) => invocation.comando === 'read_dir')).toEqual([]);
	});

	test('una carpeta que existe pero no se puede listar se resuelve por el refresco en silencio', async () => {
		// El caso que `path_exists` no cubre: la carpeta está —contesta `true`—
		// pero listarla falla, por permisos. Por la vía de la validación no se
		// navegaría; quien la atrapa es `silentRefresh`, que es el que lee. Se
		// fija que ese camino siga llegando al ancestro.
		mountNavigation();
		await openFolder();
		responder('read_dir', (args) => {
			if (String(args.path) === CURRENT_PATH) {
				throw new Error('permiso denegado');
			}

			return emptyContents(args);
		});

		await notifyChange(CURRENT_PATH);

		expect(navigation.currentPath.value).toBe(ANCESTOR_PATH);
	});
});
