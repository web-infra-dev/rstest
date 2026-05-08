import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rsbuild/core';
import { pluginSvelte } from '@rsbuild/plugin-svelte';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [pluginSvelte()],
  source: {
    entry: {
      index: './src/index.ts',
    },
    define: {
      __APP_VERSION__: JSON.stringify('1.0.0'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(dirname, 'src'),
      '@components': path.resolve(dirname, 'src/components'),
    },
  },
});
