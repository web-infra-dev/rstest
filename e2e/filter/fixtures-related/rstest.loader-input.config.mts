import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['**/*.test.ts'],
  tools: {
    rspack: {
      module: {
        rules: [
          {
            test: /[/\\]src[/\\]index\.ts$/,
            use: {
              loader: fileURLToPath(
                new URL('./build-input-loader.mjs', import.meta.url),
              ),
              options: {
                input: fileURLToPath(
                  new URL('./loader-inputs/manifest.txt', import.meta.url),
                ),
                missing: fileURLToPath(
                  new URL('./loader-inputs/optional.txt', import.meta.url),
                ),
              },
            },
          },
        ],
      },
    },
  },
});
