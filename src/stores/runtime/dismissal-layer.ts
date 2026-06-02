import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';

export type DismissalLayerType = 'clipboard' | 'selection' | 'filter' | 'drag' | 'custom';

export interface DismissalLayer {
	id: string;
	type: DismissalLayerType;
	priority: number;
	dismiss: () => void;
}

export const useDismissalLayerStore = defineStore('dismissalLayer', () => {
	const layers = reactive(new Map<string, DismissalLayer>());
	let idCounter = 0;

	const hasLayers = computed(() => layers.size > 0);

	const sortedLayers = computed(() => {
		return Array.from(layers.values()).sort(
			(layerA, layerB) => layerB.priority - layerA.priority
		);
	});

	function generateId(): string {
		return `dismissal-layer-${++idCounter}`;
	}

	function registerLayer(
		type: DismissalLayerType,
		dismiss: () => void,
		priority: number = 0,
		customId?: string
	): string {
		const layerId = customId || generateId();
		layers.set(layerId, {
			id: layerId,
			type,
			priority,
			dismiss,
		});
		return layerId;
	}

	function unregisterLayer(layerId: string) {
		layers.delete(layerId);
	}

	function hasLayerOfType(type: DismissalLayerType): boolean {
		return Array.from(layers.values()).some((layer) => layer.type === type);
	}

	function dismissTopLayer(): boolean {
		const sorted = sortedLayers.value;

		if (sorted.length === 0) {
			return false;
		}

		const topLayer = sorted[0];
		topLayer.dismiss();
		return true;
	}

	function dismissLayerOfType(type: DismissalLayerType): boolean {
		const layersOfType = Array.from(layers.values())
			.filter((layer) => layer.type === type)
			.sort((layerA, layerB) => layerB.priority - layerA.priority);

		if (layersOfType.length === 0) {
			return false;
		}

		layersOfType[0].dismiss();
		return true;
	}

	return {
		layers,
		hasLayers,
		sortedLayers,
		registerLayer,
		unregisterLayer,
		hasLayerOfType,
		dismissTopLayer,
		dismissLayerOfType,
	};
});
