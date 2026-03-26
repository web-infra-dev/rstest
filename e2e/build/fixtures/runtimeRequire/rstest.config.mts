import { defineConfig } from '@rstest/core';

export default defineConfig({
  output: {
    cleanDistPath: true,
  },
  plugins: [
    {
      name: 'test-loader',
      setup: (api) => {
        api.transform(
          { filter: /\.js$/ },
          async ({ code }: { code: string }) => {
            return code.replace(/exports\.a/g, 'exports.b');
          },
        );
      },
    },
  ],
});
