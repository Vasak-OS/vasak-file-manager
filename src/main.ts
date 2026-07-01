import I18n from '@vasakgroup/tauri-plugin-i18n';
import { createPinia } from 'pinia';
import { createApp, type Directive } from 'vue';
import { attachConsole } from '@tauri-apps/plugin-log';
import App from '@/App.vue';
import '@/assets/main.css';

attachConsole();

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
const app = createApp(App);
const pinia = createPinia();

app.directive('wave', waveDirective);

i18n.load();
app.use(pinia);
app.mount('#app');
