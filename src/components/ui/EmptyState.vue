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
			'flex flex-col items-center justify-center px-6 py-8 gap-3 text-center',
			{
				'border border-dashed border-ui-border rounded-sm': bordered,
			},
		]"
	>
		<component
			v-if="icon"
			:is="icon"
			:size="48"
			class="text-muted-foreground/30 mb-2 shrink-0"
		/>
		<h3 v-if="title" class="m-0 text-foreground text-base font-medium">
			{{ title }}
		</h3>
		<p v-if="description" class="m-0 text-muted-foreground text-[13px] leading-relaxed">
			{{ description }}
		</p>
		<slot />
	</div>
</template>


