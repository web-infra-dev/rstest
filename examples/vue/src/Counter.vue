<template>
  <div>
    <span data-testid="count">Count: {{ count }}</span>
    <button type="button" @click="increment">Increment</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface Props {
  initialCount?: number;
}

const props = withDefaults(defineProps<Props>(), {
  initialCount: 0,
});

const count = ref(props.initialCount);

const increment = () => {
  count.value++;
};
</script>
