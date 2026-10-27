import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  tools: {
    rspack: {
      module: {
        rules: [
          {
            test: /[/\\]src[/\\]index\.ts$/,
            enforce: 'pre',
            use: {
              loader: fileURLToPath(
                new URL('./name-loader.mjs', import.meta.url),
              ),
              options: {
                inputs: fileURLToPath(
                  new URL('./loader-inputs/', import.meta.url),
                ),
              },
            },
          },
        ],
      },
    },
  },
});
