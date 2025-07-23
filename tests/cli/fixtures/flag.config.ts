import { defineConfig } from '@rstest/core';

if (!process.env.RSTEST) {
  throw new Error('load config failed');
}

console.log('load config success');

export default defineConfig({});
