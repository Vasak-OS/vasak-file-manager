declare module 'vue3-smooth-dnd' {
	import type { DefineComponent } from 'vue';

	export interface DropResult<T = unknown> {
		removedIndex: number | null;
		addedIndex: number | null;
		payload: T;
		element: Element;
	}

	export interface ContainerProps {
		orientation?: 'horizontal' | 'vertical';
		behaviour?: 'move' | 'copy' | 'drop-zone' | 'contain';
		groupName?: string;
		lockAxis?: 'x' | 'y';
		dragHandleSelector?: string;
		nonDragAreaSelector?: string;
		dragBeginDelay?: number;
		animationDuration?: number;
		autoScrollEnabled?: boolean;
		dragClass?: string;
		dropClass?: string;
		removeOnDropOut?: boolean;
		dropPlaceholder?: object | boolean;
		getChildPayload?: (index: number) => unknown;
		shouldAnimateDrop?: (sourceContainerOptions: object, payload: unknown) => boolean;
		shouldAcceptDrop?: (sourceContainerOptions: object, payload: unknown) => boolean;
		getGhostParent?: () => Element | null;
		/**
		 * Los eventos, declarados como propiedades `on…`, que es como Vue los
		 * tipa.
		 *
		 * El paquete no publica tipos —esta declaración está escrita a mano— y
		 * faltaban los tres. Con `strictTemplates`, un `@drop` sobre el
		 * contenedor pasó a ser un error aunque la librería sí lo emita: la
		 * reordenación de pestañas funciona, lo que faltaba era decirlo.
		 */
		onDrop?: (resultado: DropResult) => void;
		onDragStart?: (evento: unknown) => void;
		onDragEnd?: (evento: unknown) => void;
	}

	export const Container: DefineComponent<ContainerProps>;
	export const Draggable: DefineComponent<Record<string, unknown>>;
}
