import { type Component, ref } from 'vue';

interface Toast {
	id: string | number;
	component: Component;
	componentProps: Record<string, any>;
	duration: number;
	timeoutId?: ReturnType<typeof setTimeout>;
}

const toasts = ref<Map<string | number, Toast>>(new Map());
let nextId = 0;

function generateId(): string | number {
	return `toast-${nextId++}`;
}

function add(component: Component, props: any, duration: number = 3000): string | number {
	const id = generateId();

	const toast: Toast = {
		id,
		component,
		componentProps: props,
		duration,
	};

	if (duration !== Infinity) {
		toast.timeoutId = setTimeout(() => {
			dismiss(id);
		}, duration);
	}

	toasts.value.set(id, toast);
	return id;
}

function dismiss(id: string | number): void {
	const toast = toasts.value.get(id);

	if (toast?.timeoutId) {
		clearTimeout(toast.timeoutId);
	}

	toasts.value.delete(id);
}

function dismissAll(): void {
	toasts.value.forEach((toast) => {
		if (toast.timeoutId) {
			clearTimeout(toast.timeoutId);
		}
	});

	toasts.value.clear();
}

export const toast = {
	custom: (component: Component, props: any) => {
		const duration = props.duration ?? 3000;
		return add(component, props, duration);
	},
	dismiss,
	dismissAll,
};

export const useToast = () => {
	return {
		toasts,
		toast,
	};
};
