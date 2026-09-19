/**
 * La barra lateral del gestor de archivos, montada.
 *
 * Era una tira de 40 píxeles con íconos sueltos: un disco era un dibujo de USB
 * sin nombre y para saber cuál era había que pasarle el puntero por encima y
 * esperar el tooltip; con teclado no había manera de averiguarlo. Ahora es la
 * de `@vasakgroup/vue-libvasak`, la misma que usan Configuración, el monitor y
 * la tienda.
 *
 * Lo que se comprueba acá es lo del gestor —que los lugares, los discos y las
 * cuentas en la nube estén, lleven su nombre y abran donde tienen que abrir—;
 * cómo se pliega y cómo se ve es de la librería y se prueba allá.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SideBar, SideButton } from '@vasakgroup/vue-libvasak';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import DriveCard from '@/components/drive/DriveCardComponent.vue';
import SidebarComponent from '@/components/sidebar/SidebarComponent.vue';
import ResizableHandle from '@/components/ui/ResizableHandle.vue';
import { useWorkspacesStore } from '@/stores/storage/workspaces';
import type { DriveInfo } from '@/types/drive-info';
import { olvidarTodo, responder } from './dobles';

const css = await Bun.file(new URL('../src/assets/main.css', import.meta.url)).text();
const layout = await Bun.file(
	new URL('../src/layouts/WindowAppLayout.vue', import.meta.url)
).text();
const navegador = await Bun.file(
	new URL('../src/components/navigator/NavigatorBarComponent.vue', import.meta.url)
).text();
const panel = await Bun.file(
	new URL('../src/components/filebrowser/FileBrowserComponent.vue', import.meta.url)
).text();
const locales = await Bun.file(new URL('../src-tauri/locales/es.yml', import.meta.url)).text();

/** Un disco válido; cada prueba cambia sólo lo suyo. */
function unDisco(cambios: Partial<DriveInfo> = {}): DriveInfo {
	return {
		name: 'Kingston DataTraveler',
		path: '/run/media/pato/KINGSTON',
		mount_point: '/run/media/pato/KINGSTON',
		file_system: 'vfat',
		drive_type: 'Removable',
		total_space: 16_000_000_000,
		available_space: 9_000_000_000,
		used_space: 7_000_000_000,
		percent_used: 44,
		is_removable: true,
		is_read_only: false,
		is_mounted: true,
		is_encrypted: false,
		device_path: '/dev/sdb1',
		...cambios,
	};
}

async function abrirLaBarra({
	discos = [unDisco()],
	nubes = [] as Array<{
		id: string;
		nombre: string;
		proveedor: string;
		necesita_reconectarse: boolean;
	}>,
} = {}) {
	responder('get_system_drives', discos);
	responder('listar_discos_en_la_nube', nubes);
	const pinia = createPinia();
	setActivePinia(pinia);
	// El store se pide **acá**, contra la pinia que va a recibir el montaje. Una
	// prueba que lo pida después con `useWorkspacesStore()` lee la pinia activa,
	// y con varias pruebas montadas en el mismo archivo ésa puede ser la de otra
	// prueba: se miraba un store vacío mientras el componente escribía en otro.
	const workspaces = useWorkspacesStore();
	const vista = mount(SidebarComponent, { global: { plugins: [pinia] } });
	montadas.push(vista);
	// La barra pide los discos en `onMounted` y encadena varios `await`, así
	// que un solo `nextTick` la deja a mitad de camino.
	await asentar();
	return { vista, workspaces };
}

/** Deja que terminen las promesas encadenadas de un clic. */
async function asentar(vueltas = 8) {
	for (let i = 0; i < vueltas; i++) {
		await nextTick();
		await new Promise((sigue) => setTimeout(sigue, 0));
	}
}

/** El botón de la barra cuyo texto o nombre accesible es ése. */
function botonDe(vista: Awaited<ReturnType<typeof abrirLaBarra>>['vista'], texto: string) {
	return vista.findAllComponents(SideButton).find((boton) => boton.props('label') === texto);
}

/** Lo montado en la prueba en curso, para desmontarlo al terminar. */
const montadas: Array<ReturnType<typeof mount>> = [];

beforeEach(() => {
	olvidarTodo();
});

// Un componente que queda montado sigue oyendo los avisos de discos y sigue
// escribiendo en el store de su prueba. Desmontarlo es lo que deja a la
// siguiente empezar de cero.
afterEach(() => {
	while (montadas.length) montadas.pop()?.unmount();
});

describe('la barra', () => {
	test('es la compartida y no la tira de íconos escrita acá', async () => {
		// El punto del cambio: las ventanas del escritorio se leen como partes
		// de lo mismo porque **son** lo mismo.
		const { vista } = await abrirLaBarra();

		expect(vista.findComponent(SideBar).exists()).toBe(true);
	});

	test('sin área de título, que el nombre de la ventana ya está en otro lado', async () => {
		// Lo dice el gestor de ventanas y la entrada del menú; repetirlo acá
		// gastaría la mitad del alto de la barra.
		const { vista } = await abrirLaBarra();

		const barra = vista.findComponent(SideBar);
		expect(barra.find('header').exists()).toBe(false);
		// Sin cabecera el botón de plegar necesita su propio lugar, o la barra
		// deja de poder plegarse.
		expect(barra.find('button[aria-label="barraLateral.plegar"]').exists()).toBe(true);
	});

	test('la ventana le deja aire alrededor', async () => {
		// La barra es una tarjeta con borde y esquina redondeada: pegada al
		// borde de la ventana se le come el redondeo.
		const fila = layout.slice(
			layout.lastIndexOf('<div', layout.indexOf('<SidebarComponent')),
			layout.indexOf('<SidebarComponent')
		);
		expect(fila).toContain('p-1');
		expect(fila).toContain('gap-1');
	});

	test('no se come el ancho de la barra superior', async () => {
		// Las pestañas y los botones de ventana son de la ventana, no de un
		// panel: con la barra lateral a su costado, esta ventana quedaba
		// distinta de todas las demás del escritorio.
		expect(layout.indexOf('<TopBarComponent')).toBeLessThan(layout.indexOf('<SidebarComponent'));
	});
});

describe('los lugares', () => {
	test('están Inicio y Raíz', async () => {
		const { vista } = await abrirLaBarra();

		expect(botonDe(vista, 'home')).toBeDefined();
		expect(botonDe(vista, 'root')).toBeDefined();
	});

	test('apretar Raíz abre una pestaña ahí', async () => {
		const { vista, workspaces } = await abrirLaBarra();

		await botonDe(vista, 'root')?.trigger('click');
		await asentar();

		// La pestaña abierta, no una llamada espiada: lo que importa es que la
		// ruta llegue hasta el final, y una función reemplazada no lo dice.
		expect(workspaces.currentTab?.path).toBe('/');
	});
});

describe('los discos', () => {
	test('llevan su nombre escrito y no sólo un dibujo', async () => {
		// Ésta es la razón del cambio entero. Con la tira de íconos, dos pendrives
		// enchufados eran dos dibujos idénticos y había que abrirlos para saber
		// cuál era cuál.
		const { vista } = await abrirLaBarra({
			discos: [
				unDisco({ name: 'Kingston' }),
				unDisco({ name: 'SanDisk', path: '/run/media/pato/SANDISK' }),
			],
		});

		expect(botonDe(vista, 'Kingston')).toBeDefined();
		expect(botonDe(vista, 'SanDisk')).toBeDefined();
	});

	test('conservan la tarjeta con el espacio libre', async () => {
		// El nombre alcanza para reconocerlo, no para decidir si ahí entra lo
		// que se quiere copiar.
		const { vista } = await abrirLaBarra();

		expect(vista.findComponent(DriveCard).exists()).toBe(true);
	});

	test('un disco de red no se dibuja como un pendrive', async () => {
		const { vista } = await abrirLaBarra({
			discos: [unDisco({ name: 'Documentos', drive_type: 'Network', is_removable: false })],
		});

		expect(botonDe(vista, 'Documentos')?.props('icon')).toBe('preferences-system-network-iscsi');
	});

	test('apretar uno abre su ruta', async () => {
		const { vista, workspaces } = await abrirLaBarra({
			discos: [unDisco({ path: '/run/media/pato/KINGSTON' })],
		});

		await botonDe(vista, 'Kingston DataTraveler')?.trigger('click');
		await asentar();

		expect(workspaces.currentTab?.path).toBe('/run/media/pato/KINGSTON');
	});
});

describe('las cuentas en la nube', () => {
	const unaNube = (cambios = {}) => ({
		id: 'cuenta-1',
		nombre: 'Drive de Pato',
		proveedor: 'google',
		necesita_reconectarse: false,
		...cambios,
	});

	test('aparecen con su nombre', async () => {
		const { vista } = await abrirLaBarra({ nubes: [unaNube()] });

		expect(botonDe(vista, 'Drive de Pato')).toBeDefined();
	});

	test('una que hay que reconectar sigue alcanzable y dice qué falta', async () => {
		// Un botón deshabilitado no recibe foco, y entonces quien usa teclado o
		// lector de pantalla no puede llegar nunca a la instrucción.
		const { vista } = await abrirLaBarra({ nubes: [unaNube({ necesita_reconectarse: true })] });

		const boton = botonDe(vista, 'cloudNeedsReconnect');
		expect(boton).toBeDefined();
		expect(boton?.props('disabled')).toBe(false);

		await boton?.trigger('click');
		await nextTick();

		// El motivo se muestra: antes se guardaba en una variable y no se
		// dibujaba, así que apretar el disco no hacía nada visible.
		expect(vista.find('[role="status"]').text()).toContain('cloudNeedsReconnect');
	});

	test('montarla no dispara dos montajes seguidos', async () => {
		// Mientras el montaje está en curso el botón queda apagado: dos
		// montajes del mismo disco se pisan y el segundo falla.
		let resolver: (ruta: string) => void = () => {};
		responder(
			'montar_disco_en_la_nube',
			() =>
				new Promise<string>((sigue) => {
					resolver = sigue;
				})
		);
		const { vista } = await abrirLaBarra({ nubes: [unaNube()] });

		await botonDe(vista, 'Drive de Pato')?.trigger('click');
		await nextTick();

		expect(botonDe(vista, 'Drive de Pato')?.props('disabled')).toBe(true);
		resolver('/run/user/1000/gvfs/drive');
	});
});

describe('la hoja de estilos', () => {
	test('escanea la librería, o la barra llega sin ninguna de sus reglas', () => {
		// Tailwind v4 no mira dentro de `node_modules`. Sin esta línea, las
		// clases que sólo existen en los componentes de la librería no entran
		// nunca en la hoja: la ventana abre con el marcado puesto y sin
		// paddings, sin anchos y con los iconos a tamaño natural. Pasó.
		expect(css).toContain('@source');
		expect(css).toContain('@vasakgroup/vue-libvasak');
	});
});

describe('la barra de ruta', () => {
	// Es la de atrás/adelante y la ruta. Con un panel solo sube al nivel de la
	// ventana y cruza todo el ancho; en vista dividida cada panel se queda con
	// la suya, que es lo único que deja ver las dos rutas a la vez.

	/** El trozo de plantilla de la rama de vista dividida. */
	const dividida = navegador.slice(
		navegador.indexOf('v-if="workspacesStore.currentTabGroup && isSplitView"'),
		navegador.indexOf('v-else-if="workspacesStore.currentTabGroup"')
	);

	test('el panel único la manda arriba de todo', () => {
		const solo = navegador.slice(navegador.indexOf('v-else-if="workspacesStore.currentTabGroup"'));
		expect(solo).toContain('toolbar-teleport-target=".window-path-teleport-target"');
	});

	test('la ventana tiene dónde ponerla, y no encima de la barra lateral', () => {
		// La barra de ruta es de lo que se está mirando, no de la ventana: va
		// en la columna de contenido, después de la lateral. Cruzándola por
		// encima, la lateral dejaba de llegar de arriba abajo y quedaba
		// acortada sin motivo.
		expect(layout).toContain('window-path-teleport-target');
		expect(layout.indexOf('<SidebarComponent')).toBeLessThan(
			layout.indexOf('window-path-teleport-target')
		);
		expect(layout.indexOf('window-path-teleport-target')).toBeLessThan(
			layout.indexOf('<NavigatorBarComponent')
		);
	});

	test('y no se le suma un hueco propio', () => {
		// La ventana separa todo con `gap-1`. Un `p-1` extra alrededor de la
		// barra de ruta hacía el doble de distancia justo ahí, y esta ventana
		// se leía distinta de las otras del escritorio.
		const clases = layout.match(/class="window-path-teleport-target([^"]*)"/)?.[1] ?? '';
		// Las clases del propio destino, no las del vecino: `gap-1` contiene
		// `p-1` como subcadena y buscar a ojo dentro de un trozo de plantilla
		// daba por relleno lo que era separación. Pasó.
		const relleno = clases.split(/\s+/).filter((clase) => /^p[xytblre]?-/.test(clase));
		expect(relleno).toEqual([]);
	});

	test('en vista dividida cada panel se queda con la suya', () => {
		// Los dos paneles muestran rutas distintas y llevan su propio historial
		// de atrás y adelante: una sola barra arriba tendría que elegir cuál de
		// las dos dice, y la otra quedaría sin ruta visible.
		expect(dividida).toContain('<FileBrowserComponent');
		expect(dividida).not.toContain('toolbar-teleport-target');
	});

	test('se busca el destino después de dibujar, o no se dibuja en ningún lado', () => {
		// Vue arma el árbol entero en memoria y recién después lo mete en el
		// documento: sin `defer`, el `querySelector` del teletransporte da nulo
		// y la barra desaparece. Pasó, y la ventana quedó sin forma de navegar.
		const teletransporte = panel.slice(panel.indexOf('<Teleport'), panel.indexOf('</Teleport>'));
		expect(teletransporte).toContain('defer');
	});
});

describe('las claves de traducción', () => {
	/**
	 * Lo que ya estaba así antes de esta rama.
	 *
	 * No es un descuido de acá: son pantallas enteras que imprimen la clave en
	 * vez del texto —la búsqueda global es la peor, con `globalSearch.*` y un
	 * `` `item, ${n}` `` de contador—. Arreglarlas es escribir y revisar
	 * traducciones de media aplicación, que es un trabajo aparte del de la
	 * barra lateral y va por su propio issue.
	 *
	 * Se excepcionan **nombrándolas**, no ensanchando la regla: cada archivo
	 * que se arregle sale de esta lista, y el resto del árbol —el 95%— queda
	 * cubierto desde hoy.
	 */
	const DEUDA = [
		'views/GlobalSearchView.vue',
		'composables/file-browser/use-file-browser-selection.ts',
		'components/navigator/ClipboardToolbarComponent.vue',
		'components/filebrowser/FileBrowserStatusBarComponent.vue',
		'components/drag/DragOverlayComponent.vue',
		'components/drag/InboundDragOverlayComponent.vue',
		'components/dialogs/ConflictDialogComponent.vue',
	];

	test('no se escriben a mano adentro de una cadena', async () => {
		// `` `fileBrowser.itemCount ${n}` `` no es una traducción: es la clave
		// impresa tal cual. Cada carpeta de la cuadrícula decía
		// «fileBrowser.itemCount 3» en vez de «3 elementos».
		const raices = [...locales.matchAll(/^(\w+):$/gm)].map((coincidencia) => coincidencia[1]);
		expect(raices.length).toBeGreaterThan(5);

		const fuentes = [
			...new Bun.Glob('**/*.{vue,ts}').scanSync({
				cwd: new URL('../src', import.meta.url).pathname,
			}),
		].filter((archivo) => !DEUDA.includes(archivo));
		// Sin esto, un glob que no encuentra nada deja la prueba en verde.
		expect(fuentes.length).toBeGreaterThan(50);

		const culpables: string[] = [];
		for (const archivo of fuentes) {
			const fuente = await Bun.file(new URL(`../src/${archivo}`, import.meta.url)).text();
			for (const raiz of raices) {
				if (fuente.includes(`\`${raiz}.`)) culpables.push(`${archivo} → ${raiz}.…`);
			}
		}

		expect(culpables).toEqual([]);
	});
});

describe('la división de la pantalla', () => {
	test('cada panel es su propia tarjeta', () => {
		// Dos paneles del mismo color pegados uno al otro: el contenido de la
		// derecha parecía seguir al de la izquierda. Se probó con una línea
		// divisoria adentro de un panel único y quedaba peor que separarlos:
		// dos tarjetas con su borde y su fondo dicen solas dónde termina una.
		const panes = navegador.slice(navegador.indexOf('<ResizablePanelGroup'));
		// El espacio o la comilla después de `pane` a propósito: sin eso el
		// contenedor `navigator-page__panes` cuenta como un panel más.
		const apariciones = [...panes.matchAll(/class="navigator-page__pane( [^"]*)?"/g)];
		// Los tres usos: los dos de la vista dividida y el del panel único.
		expect(apariciones).toHaveLength(3);

		for (const [, resto = ''] of apariciones) {
			expect(resto).toContain('rounded-corner');
			expect(resto).toContain('border-ui-border');
			expect(resto).toContain('bg-ui-surface/70');
		}
	});

	test('el tirador es el aire entre las dos, y se estira de arriba abajo', () => {
		// `h-full` sobre una fila sin alto definido se resuelve en `auto`, y en
		// un div vacío eso es cero: el tirador ocupaba su ancho —los paneles se
		// corrían— pero no se dibujaba nada de lo que se le pusiera. Se vio
		// pintándolo de rojo.
		//
		// El contexto del grupo va puesto: sin él el tirador se cree vertical
		// —la división de la pantalla es horizontal— y se comprobaría la rama
		// que no es. Pasó: el sabotaje de la rama horizontal no volteaba nada.
		for (const horizontal of [true, false]) {
			const vista = mount(ResizableHandle, {
				global: {
					provide: {
						'resizable-panel-group': { startDrag() {}, isHorizontal: { value: horizontal } },
					},
				},
			});

			const clases = vista.find('div').classes();
			expect(clases).toContain('self-stretch');
			expect(clases).not.toContain('h-full');
			expect(clases).not.toContain('w-full');
			// Sin fondo propio: el hueco deja ver la ventana entre las dos
			// tarjetas, que es lo que las separa.
			expect(clases.some((clase) => /^bg-/.test(clase))).toBe(false);
		}
	});
});

describe('la versión de la librería', () => {
	test('trae el arreglo de la barra que abría plegada', async () => {
		// En WebKitGTK no llega ni el `change` de `matchMedia` ni el `resize`
		// de la ventana cuando ésta pasa de angosta a ancha al terminar de
		// abrirse: la barra se montaba con el WebView todavía sin tamaño y se
		// quedaba plegada para siempre en una ventana de 1280 que nadie había
		// plegado. Que acá anduviera con la 0.3.5 era que el montaje cae
		// después de que el WebView tiene tamaño — una carrera. La 0.3.6 mide
		// con un `ResizeObserver`, así que volver atrás de ahí lo trae de
		// vuelta.
		const manifiesto = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
			dependencies: Record<string, string>;
		};
		const pedido = manifiesto.dependencies['@vasakgroup/vue-libvasak'];
		expect(pedido).toBeDefined();

		const [mayor, menor, parche] = pedido
			.replace(/^[^\d]*/, '')
			.split('.')
			.map(Number);
		const numero = mayor * 1_000_000 + menor * 1_000 + parche;
		expect(numero).toBeGreaterThanOrEqual(0 * 1_000_000 + 3 * 1_000 + 6);
	});
});
