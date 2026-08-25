import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { ref } from 'vue';
import type { DirEntry } from '@/types/dir-entry';

/**
 * Miniaturas de video, generadas por el backend.
 *
 * Antes se hacían acá: un `<video>` oculto, un `seek` al 10 % y un `<canvas>`
 * **del tamaño del video** del que se pedía un JPEG. Un archivo 4K decodificaba
 * 8,3 millones de píxeles dentro del proceso de la interfaz para producir una
 * imagen de doscientos píxeles de lado, la data URL en base64 se quedaba en
 * memoria, y como no se guardaba nada, todo volvía a pasar en cada visita a la
 * carpeta.
 *
 * Ahora lo hace ffmpeg de una pasada, fuera de este proceso, y el resultado
 * queda en la caché de miniaturas del usuario. Lo que cruza el IPC es una ruta,
 * no una imagen.
 */

/**
 * Cuántas se piden a la vez.
 *
 * Más alto que antes: el costo se pagaba en este proceso y competía con el
 * dibujado, y ahora son procesos aparte que el planificador reparte solo. Igual
 * con techo, para no lanzar cien ffmpeg al abrir una carpeta de videos.
 */
const MAX_CONCURRENTES = 6;

export function useVideoThumbnails() {
	/** Ruta del video -> URL que la vista puede dibujar. */
	const videoThumbnails = ref<Record<string, string>>({});
	const cola: string[] = [];
	const enCurso = new Set<string>();
	/**
	 * Los que fallaron. Sin esto, un video que ffmpeg no puede abrir se vuelve a
	 * intentar en cada redibujado, porque `getVideoThumbnail` no encuentra nada
	 * en la caché y vuelve a pedirlo.
	 */
	const fallados = new Set<string>();

	async function generar(videoPath: string): Promise<string> {
		enCurso.add(videoPath);
		try {
			const ruta = await invoke<string>('video_thumbnail', { path: videoPath });
			const url = convertFileSrc(ruta);
			// Asignar la clave, no copiar el registro. `videoThumbnails` es un
			// `ref` reactivo profundo, así que la asignación ya notifica; el
			// spread copiaba todo el objeto por cada miniatura terminada, o sea
			// O(n²) de asignaciones en una carpeta con muchos videos.
			videoThumbnails.value[videoPath] = url;
			return url;
		} catch (error) {
			// Un formato que ffmpeg no abre no es un error de la aplicación: la
			// vista se queda con el icono genérico del archivo.
			console.debug('[miniaturas] no se pudo generar para', videoPath, error);
			fallados.add(videoPath);
			return '';
		} finally {
			enCurso.delete(videoPath);
			siguiente();
		}
	}

	function siguiente() {
		while (enCurso.size < MAX_CONCURRENTES) {
			const ruta = cola.shift();
			if (!ruta) {
				return;
			}
			if (videoThumbnails.value[ruta] || enCurso.has(ruta) || fallados.has(ruta)) {
				continue;
			}
			void generar(ruta);
		}
	}

	function generateVideoThumbnail(videoPath: string): Promise<string> {
		const yaEsta = videoThumbnails.value[videoPath];
		if (yaEsta) {
			return Promise.resolve(yaEsta);
		}
		if (fallados.has(videoPath) || enCurso.has(videoPath)) {
			return Promise.resolve('');
		}
		if (enCurso.size >= MAX_CONCURRENTES) {
			if (!cola.includes(videoPath)) {
				cola.push(videoPath);
			}
			return Promise.resolve('');
		}
		return generar(videoPath);
	}

	function getVideoThumbnail(entry: DirEntry): string | undefined {
		const cached = videoThumbnails.value[entry.path];

		if (!cached && !enCurso.has(entry.path) && !fallados.has(entry.path)) {
			void generateVideoThumbnail(entry.path);
		}

		return cached;
	}

	function clearThumbnails() {
		videoThumbnails.value = {};
		cola.length = 0;
		// Los fallados no se limpian: el archivo sigue siendo el mismo y volver a
		// intentarlo al cambiar de carpeta es exactamente el bucle que el conjunto
		// evita.
	}

	return {
		videoThumbnails,
		getVideoThumbnail,
		generateVideoThumbnail,
		clearThumbnails,
	};
}
