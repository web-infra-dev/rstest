<template>
  <div class="content">
    <h1>{{ greeting }}</h1>
    <p>Start building amazing things with Vue.</p>
  </div>
</template>

<script setup lang="ts">
interface Props {
  greeting?: string;
}

withDefaults(defineProps<Props>(), {
  greeting: 'Hello World',
});
</script>

<style scoped>
.content {
  display: flex;
  min-height: 100vh;
  line-height: 1.1;
  text-align: center;
  flex-direction: column;
  justify-content: center;
}

.content h1 {
  font-size: 3.6rem;
  font-weight: 700;
}

.content p {
  font-size: 1.2rem;
  font-weight: 400;
  opacity: 0.5;
}
</style>
