<script setup lang="ts">
interface Props {
	icon?: any;
	title?: string;
	description?: string;
	bordered?: boolean;
}

withDefaults(defineProps<Props>(), {
	bordered: true,
});
</script>

<template>
	<div
		:class="[
			'empty-state',
			{
				'empty-state--bordered': bordered,
			},
		]"
	>
		<component
			v-if="icon"
			:is="icon"
			:size="48"
			class="empty-state__icon"
		/>
		<h3 v-if="title" class="empty-state__title">
			{{ title }}
		</h3>
		<p v-if="description" class="empty-state__description">
			{{ description }}
		</p>
		<slot />
	</div>
</template>

<style scoped>
.empty-state {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 32px 24px;
	gap: 12px;
	text-align: center;
}

.empty-state--bordered {
	border: 1px dashed hsl(var(--border));
	border-radius: var(--radius-sm);
}

.empty-state__icon {
	color: hsl(var(--muted-foreground) / 30%);
	margin-bottom: 8px;
	flex-shrink: 0;
}

.empty-state__title {
	margin: 0;
	color: hsl(var(--foreground));
	font-size: 16px;
	font-weight: 500;
}

.empty-state__description {
	margin: 0;
	color: hsl(var(--muted-foreground));
	font-size: 13px;
	line-height: 1.5;
}
</style>
