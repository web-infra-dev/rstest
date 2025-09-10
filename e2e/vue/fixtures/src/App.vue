<template>
  <div class="content">
    <h1>Rsbuild with Vue</h1>
    <p>Start building amazing things with Rsbuild.</p>
    <button @click="onClickApp">Click me</button>
  </div>
</template>

<script setup>
const emit = defineEmits(['clickApp']);
const onClickApp = (event) => emit('clickApp', event);
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

.content .button1 {
  width: 30%;
  margin: 0 auto;
  padding: 0.8rem 1.2rem;
  font-size: 1.2rem;
  border-radius: 4px;
  background-color: #42b983;
  color: white;
  border: none;
  cursor: pointer;
}
</style>
