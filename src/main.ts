import { createPinia } from 'pinia';
import { createApp } from 'vue';
import I18n from '@vasakgroup/tauri-plugin-i18n';
import App from '@/App.vue';
import '@/style.css';

const i18n = I18n.getInstance()
const app = createApp(App);
const pinia = createPinia();

i18n.load()
app.use(pinia);
app.mount('#app');
