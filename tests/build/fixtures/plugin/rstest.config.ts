import path from 'node:path';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'node',
  plugins: [
    {
      name: 'plugin',
      setup(api) {
        api.transform({ test: /.\/a.ts$/ }, ({ code }) => {
          return code.replace('count = 1', 'count = 2');
        });
      },
    },
  ],
});
