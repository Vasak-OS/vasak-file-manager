type AnyFn = (...args: any[]) => any;

interface DebouncedFnReturn<T extends AnyFn> {
	/** Ejecutar la función con debounce */
	execute: (...args: Parameters<T>) => void;
	/** Cancelar la ejecución pendiente */
	cancel: () => void;
}

interface ThrottledFnReturn<T extends AnyFn> {
	/** Ejecutar la función con throttle */
	execute: (...args: Parameters<T>) => void;
	/** Cancelar la ejecución pendiente */
	cancel: () => void;
}

interface BatchAccumulatorReturn<T> {
	/** Agregar un item al acumulador */
	push: (item: T) => void;
	/** Forzar el procesamiento de items acumulados */
	flush: () => void;
	/** Cancelar procesamiento pendiente y limpiar el buffer */
	cancel: () => void;
}

/**
 * Crea una función con debounce configurable y cancelación explícita.
 *
 * Retrasa la ejecución hasta que transcurran `delay` ms de inactividad.
 * Cada nueva llamada reinicia el temporizador.
 *
 * Requirement 6.1: debounce de 150ms para filtro.
 * Requirement 6.5: cancelación al navegar.
 */
export function createDebouncedFn<T extends AnyFn>(fn: T, delay: number): DebouncedFnReturn<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;

	const execute = (...args: Parameters<T>) => {
		if (timer) {
			clearTimeout(timer);
		}

		timer = setTimeout(() => {
			timer = null;
			fn(...args);
		}, delay);
	};

	const cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};

	return { execute, cancel };
}

/**
 * Crea una función con throttle que ejecuta inmediatamente en la primera
 * llamada y luego limita a máximo una ejecución por `interval` ms.
 *
 * Requirement 6.2: throttle de 16ms para 60fps en resize.
 * Requirement 6.5: cancelación al navegar.
 */
export function createThrottledFn<T extends AnyFn>(fn: T, interval: number): ThrottledFnReturn<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: Parameters<T> | null = null;
	let lastCallTime = 0;

	const execute = (...args: Parameters<T>) => {
		const now = Date.now();
		const elapsed = now - lastCallTime;

		if (elapsed >= interval) {
			// Suficiente tiempo transcurrido: ejecutar inmediatamente
			lastCallTime = now;
			fn(...args);
		} else {
			// Dentro del intervalo: programar ejecución al final del periodo
			lastArgs = args;

			if (!timer) {
				const remaining = interval - elapsed;
				timer = setTimeout(() => {
					timer = null;
					lastCallTime = Date.now();
					if (lastArgs) {
						fn(...lastArgs);
						lastArgs = null;
					}
				}, remaining);
			}
		}
	};

	const cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		lastArgs = null;
		lastCallTime = 0;
	};

	return { execute, cancel };
}

/**
 * Crea un acumulador de items en batch que procesa periódicamente.
 *
 * Los items se acumulan y se procesan cada `interval` ms o cuando
 * se alcanza `maxBatchSize`, lo que ocurra primero.
 *
 * Requirement 6.4: agrupar cambios del watcher, 500ms, max 200.
 * Requirement 6.5: cancelación al navegar.
 */
export function createBatchAccumulator<T>(
	processor: (items: T[]) => void,
	interval: number,
	maxBatchSize: number
): BatchAccumulatorReturn<T> {
	let buffer: T[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;

	const scheduleFlush = () => {
		if (timer) return;

		timer = setTimeout(() => {
			timer = null;
			processBuffer();
		}, interval);
	};

	const processBuffer = () => {
		if (buffer.length === 0) return;

		const batch = buffer.splice(0, maxBatchSize);
		processor(batch);

		// Si aún quedan items, programar otro flush
		if (buffer.length > 0) {
			scheduleFlush();
		}
	};

	const push = (item: T) => {
		buffer.push(item);

		if (buffer.length >= maxBatchSize) {
			// Alcanzó el límite: procesar inmediatamente
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			processBuffer();
		} else {
			scheduleFlush();
		}
	};

	const flush = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		processBuffer();
	};

	const cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		buffer = [];
	};

	return { push, flush, cancel };
}
