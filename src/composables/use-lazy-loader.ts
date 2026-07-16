import { onUnmounted } from 'vue';

export interface LazyLoaderOptions {
	/** Distancia en px desde el viewport para iniciar carga */
	threshold?: number; // default: 200
	/** Máximo de cargas concurrentes */
	concurrency?: number; // default: 3
	/** Debounce de scroll para iniciar cargas */
	scrollDebounce?: number; // default: 100
}

export interface LazyLoaderReturn {
	/** Registrar una entrada para observar */
	observe: (path: string, element: HTMLElement) => void;
	/** Des-registrar una entrada */
	unobserve: (path: string) => void;
	/** Cancelar todas las cargas pendientes */
	cancelAll: () => void;
	/** Estado de carga por path */
	getLoadState: (path: string) => 'idle' | 'loading' | 'loaded' | 'error';
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface QueueEntry {
	path: string;
	element: HTMLElement;
}

/** Timeout por carga individual (Requirement 2.5) */
const DEFAULT_LOAD_TIMEOUT = 10_000;

/** Threshold por defecto en px (Requirement 2.1) */
const DEFAULT_THRESHOLD = 200;

/** Concurrencia máxima por defecto (Requirement 2.1) */
const DEFAULT_CONCURRENCY = 3;

/** Debounce de scroll por defecto (Requirement 6.3) */
const DEFAULT_SCROLL_DEBOUNCE = 100;

/**
 * Composable de carga diferida con IntersectionObserver.
 *
 * Observa elementos y cuando están a `threshold` px del viewport,
 * encola la carga de su recurso. Limita concurrencia y permite
 * cancelar todas las cargas pendientes al navegar.
 *
 * Requirement 2.1: carga cuando entry está a 200px del viewport,
 *   máximo 3 cargas concurrentes, cola FIFO para las restantes.
 * Requirement 2.4: cancelAll vacía cola y cancela pendientes en <100ms.
 * Requirement 2.5: timeout de 10s por carga, mostrar icono genérico.
 */
export function useLazyLoader(
	loadFn: (path: string) => Promise<void>,
	options: LazyLoaderOptions = {},
): LazyLoaderReturn {
	const {
		threshold = DEFAULT_THRESHOLD,
		concurrency = DEFAULT_CONCURRENCY,
		scrollDebounce = DEFAULT_SCROLL_DEBOUNCE,
	} = options;

	// --- Estado interno ---

	/** Estado de carga por path */
	const states = new Map<string, LoadState>();

	/** Elementos registrados por path */
	const elements = new Map<string, HTMLElement>();

	/** Cola FIFO de cargas pendientes */
	let queue: QueueEntry[] = [];

	/** Cargas activas actualmente */
	let activeCount = 0;

	/** AbortControllers para cargas en progreso */
	const abortControllers = new Map<string, AbortController>();

	/** Timer de debounce de scroll */
	let scrollDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	/** Paths que entraron al umbral pero esperan el debounce */
	let pendingIntersections: QueueEntry[] = [];

	// --- IntersectionObserver ---

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;

				// Buscar el path asociado al elemento
				const path = findPathForElement(entry.target as HTMLElement);
				if (!path) continue;

				const currentState = states.get(path);
				if (currentState === 'loading' || currentState === 'loaded') continue;

				// Acumular para debounce
				pendingIntersections.push({ path, element: entry.target as HTMLElement });
			}

			// Aplicar debounce de scroll antes de iniciar cargas
			scheduleProcessIntersections();
		},
		{
			rootMargin: `${threshold}px`,
			threshold: 0,
		},
	);

	// --- Helpers ---

	function findPathForElement(element: HTMLElement): string | null {
		for (const [path, el] of elements) {
			if (el === element) return path;
		}
		return null;
	}

	function scheduleProcessIntersections() {
		if (scrollDebounceTimer !== null) {
			clearTimeout(scrollDebounceTimer);
		}

		scrollDebounceTimer = setTimeout(() => {
			scrollDebounceTimer = null;
			flushPendingIntersections();
		}, scrollDebounce);
	}

	function flushPendingIntersections() {
		const pending = pendingIntersections;
		pendingIntersections = [];

		for (const entry of pending) {
			const currentState = states.get(entry.path);
			if (currentState === 'loading' || currentState === 'loaded') continue;

			enqueue(entry);
		}
	}

	function enqueue(entry: QueueEntry) {
		// Evitar duplicados en la cola
		if (queue.some((q) => q.path === entry.path)) return;

		states.set(entry.path, 'idle');
		queue.push(entry);
		processQueue();
	}

	function processQueue() {
		while (activeCount < concurrency && queue.length > 0) {
			const entry = queue.shift()!;
			startLoad(entry);
		}
	}

	function startLoad(entry: QueueEntry) {
		const { path } = entry;

		// Si ya está cargando o cargado, saltar
		const currentState = states.get(path);
		if (currentState === 'loading' || currentState === 'loaded') return;

		activeCount++;
		states.set(path, 'loading');

		const controller = new AbortController();
		abortControllers.set(path, controller);

		// Crear promesa de carga con timeout
		const timeoutId = setTimeout(() => {
			controller.abort();
		}, DEFAULT_LOAD_TIMEOUT);

		const loadPromise = loadFn(path);

		// Carrera entre carga y abort
		Promise.race([
			loadPromise,
			new Promise<never>((_, reject) => {
				controller.signal.addEventListener('abort', () => {
					reject(new Error('aborted'));
				});
			}),
		])
			.then(() => {
				clearTimeout(timeoutId);
				if (!controller.signal.aborted) {
					states.set(path, 'loaded');
				}
			})
			.catch(() => {
				clearTimeout(timeoutId);
				// Solo marcar error si no fue cancelación global (cancelAll)
				if (states.has(path) && states.get(path) === 'loading') {
					states.set(path, 'error');
				}
			})
			.finally(() => {
				abortControllers.delete(path);
				activeCount--;
				processQueue();
			});
	}

	// --- API pública ---

	function observe(path: string, element: HTMLElement) {
		// Si ya está registrado con el mismo elemento, no hacer nada
		if (elements.get(path) === element) return;

		// Si tenía un elemento anterior, des-observar
		if (elements.has(path)) {
			observer.unobserve(elements.get(path)!);
		}

		elements.set(path, element);
		if (!states.has(path)) {
			states.set(path, 'idle');
		}

		observer.observe(element);
	}

	function unobserve(path: string) {
		const element = elements.get(path);
		if (element) {
			observer.unobserve(element);
			elements.delete(path);
		}

		// Remover de la cola si está pendiente
		queue = queue.filter((q) => q.path !== path);

		// Si está cargando, abortar
		const controller = abortControllers.get(path);
		if (controller) {
			controller.abort();
			abortControllers.delete(path);
			activeCount--;
		}

		states.delete(path);
	}

	function cancelAll() {
		// Cancelar debounce pendiente
		if (scrollDebounceTimer !== null) {
			clearTimeout(scrollDebounceTimer);
			scrollDebounceTimer = null;
		}

		// Limpiar intersecciones pendientes
		pendingIntersections = [];

		// Vaciar cola FIFO
		queue = [];

		// Abortar todas las cargas activas
		for (const [path, controller] of abortControllers) {
			controller.abort();
			states.set(path, 'idle');
		}
		activeCount = 0;
		abortControllers.clear();
	}

	function getLoadState(path: string): LoadState {
		return states.get(path) ?? 'idle';
	}

	// --- Cleanup ---

	onUnmounted(() => {
		cancelAll();
		observer.disconnect();
		elements.clear();
		states.clear();
	});

	return {
		observe,
		unobserve,
		cancelAll,
		getLoadState,
	};
}
