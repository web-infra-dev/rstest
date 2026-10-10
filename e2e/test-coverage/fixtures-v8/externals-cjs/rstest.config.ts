import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

const srcDir = fileURLToPath(new URL('./src/', import.meta.url));

export default defineConfig({
  include: ['test/**/*.test.ts'],
  output: {
    // Load the CommonJS sources through the worker's external loader instead
    // of bundling them.
    externals: [
      ({ request }, callback) => {
        const match = request?.match(/^\.\.\/src\/(.+\.cjs)$/);
        return match
          ? callback(undefined, `commonjs ${srcDir}${match[1]}`)
          : callback();
      },
    ],
  },
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.cjs'],
    reporters: ['json'],
  },
});
