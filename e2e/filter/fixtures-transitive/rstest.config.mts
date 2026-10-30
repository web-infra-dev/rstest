import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['**/*.test.ts'],
  tools: {
    rspack: {
      module: {
        rules: [
          {
            test: /[/\\]src[/\\]transitive-c\.ts$/,
            use: {
              loader: fileURLToPath(
                new URL(
                  '../fixtures-related/build-input-loader.mjs',
                  import.meta.url,
                ),
              ),
              options: {
                input: fileURLToPath(
                  new URL('./src/transitive-b.ts', import.meta.url),
                ),
              },
            },
          },
        ],
      },
    },
  },
});
