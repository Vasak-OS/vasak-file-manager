/**
 * Lo que `strictTemplates` no sabe de los atributos `data-*`.
 *
 * Con `vueCompilerOptions.strictTemplates`, `vue-tsc` comprueba que cada
 * atributo de una plantilla exista: en un componente, que sea una propiedad
 * declarada o un evento que emite; en un elemento, que esté en el tipo de ese
 * elemento. Es lo que hace que un `:size` sobre un `<img>` —que no hace nada—
 * o un componente escrito con un nombre que no existe dejen de pasar en
 * silencio.
 *
 * Los `data-*` son la excepción legítima: HTML los permite todos, y acá se usan
 * para marcar nodos que después se buscan con `closest()` o `querySelector()`.
 * Sin esto, `strictTemplates` los rechaza uno por uno.
 *
 * Se declara el patrón, no cada nombre: una lista de nombres queda vieja en
 * cuanto alguien marca un nodo nuevo, y lo que se quiere permitir es la forma.
 */
declare module 'vue' {
	interface HTMLAttributes {
		[atributo: `data-${string}`]: unknown;
	}

	/**
	 * Las directivas que se registran a mano en `main.ts`.
	 *
	 * `app.directive('wave', …)` la deja disponible en toda plantilla, pero no
	 * escribe nada en los tipos: `vue-tsc` la busca acá, con el nombre en
	 * camello y la `v` adelante, y sin esto `strictTemplates` rechaza el
	 * `v-wave` de la pestaña. La directiva existe y funciona —es la onda al
	 * hacer clic—; lo que faltaba era declararla.
	 */
	interface GlobalDirectives {
		vWave: import('vue').Directive<HTMLElement>;
	}
}

export {};
