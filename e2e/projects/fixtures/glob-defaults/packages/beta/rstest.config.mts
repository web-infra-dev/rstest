import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: { root: fileURLToPath(new URL('./suite', import.meta.url)) },
  setupFiles: ['./local.ts'],
});
