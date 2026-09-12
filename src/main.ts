import { attachConsole } from '@tauri-apps/plugin-log';
import { getIconSource } from '@vasakgroup/plugin-vicons';
import { setupContextMenu } from '@vasakgroup/plugin-vsk-contextual-menu';
import I18n from '@vasakgroup/tauri-plugin-i18n';
import { createPinia } from 'pinia';
import { createApp, type Directive } from 'vue';
import App from '@/App.vue';
import { sanearUrl } from '@/tools/csp';
import { disableWebViewFeatures } from '@/utils/web-view-features';
import '@/assets/main.css';
import { captureFailures } from '@vasakgroup/plugin-vsk-journal';

/**
 * Cuánto se espera a las traducciones antes de montar.
 *
 * Se espera para que la primera pantalla no muestre las claves crudas, pero con
 * un plazo: si el backend no contesta, es mejor una interfaz con las claves a la
 * vista que una ventana en blanco para siempre.
 */
const PLAZO_TRADUCCIONES_MS = 3000;

// Una violación de CSP no se ve: el recurso no carga y la interfaz queda a
// medias sin decir nada. Se sanean **las dos** URLs, porque `sourceFile` también
// puede llevar query con datos sensibles.
document.addEventListener('securitypolicyviolation', (evento) => {
	// El respaldo va **después** de sanear, no antes.
	//
	// Mirando el valor crudo, una entrada como `?token=X` es verdadera y
	// pasa el respaldo de largo — pero lo que queda de ella al sanearla es
	// nada, así que el registro salía con el campo en blanco. Sanear
	// primero y decidir después es lo que hace que un aviso incompleto no
	// exista.
	const recurso = sanearUrl(evento.blockedURI) || '(en línea)';
	const origen = sanearUrl(evento.sourceFile) || 'documento';
	console.error(
		`[CSP] bloqueado ${recurso} por la directiva ` +
			`«${evento.violatedDirective}» en ${origen}:${evento.lineNumber}`
	);
});

attachConsole();

// El menú del clic derecho del escritorio, una sola vez para toda la
// aplicación: le enseña a resolver los nombres de iconos del sistema y apaga el
// menú que dibuja WebKit, que ofrece «Recargar» e «Inspeccionar elemento» sobre
// una aplicación que no es una página web.
setupContextMenu({ iconResolver: getIconSource });

disableWebViewFeatures();

const waveDirective: Directive<HTMLElement> = {
	mounted(el) {
		el.style.position = 'relative';
		el.style.overflow = 'hidden';
		el.style.cursor = 'pointer';
		const handler = (e: MouseEvent) => {
			const rect = el.getBoundingClientRect();
			const size = Math.max(rect.width, rect.height);
			const x = e.clientX - rect.left - size / 2;
			const y = e.clientY - rect.top - size / 2;
			const ripple = document.createElement('span');
			ripple.style.cssText = [
				'position:absolute',
				'pointer-events:none',
				`width:${size}px`,
				`height:${size}px`,
				`left:${x}px`,
				`top:${y}px`,
				'border-radius:50%',
				'background:currentColor',
				'opacity:0.2',
				'transform:scale(0)',
				'animation:wave-ripple 0.5s ease-out',
			].join(';');
			el.appendChild(ripple);
			setTimeout(() => ripple.remove(), 500);
		};
		el.addEventListener('click', handler);
		(el as any).__waveCleanup = () => el.removeEventListener('click', handler);
	},
	unmounted(el) {
		(el as any).__waveCleanup?.();
	},
};

const i18n = I18n.getInstance();
// Lo que rompe la interfaz va al diario del sistema, con el nombre de esta
// aplicación. Antes no iba a ninguna parte: un error de JavaScript deja la
// pantalla a medias y la consola del WebView no la ve nadie en una máquina
// instalada.
captureFailures();

const app = createApp(App);
const pinia = createPinia();

app.directive('wave', waveDirective);

app.use(pinia);
// Se esperan las traducciones antes de montar: montando primero, la ventana
// enseña las claves crudas —«views.home.title» donde va el texto— hasta que el
// catálogo termina de cargar.
//
// Antes esto era un `i18n.load()` suelto, sin esperar. Y hasta la 2.3.0 del
// plugin esperarlo tampoco habría servido: la clase y el composable guardaban el
// catálogo por separado, y el `t()` de los componentes lee el del composable.
await Promise.race([
	i18n.load().catch((error) => {
		console.error('No se pudieron cargar las traducciones', error);
	}),
	new Promise((resolve) => setTimeout(resolve, PLAZO_TRADUCCIONES_MS)),
]);

app.mount('#app');
