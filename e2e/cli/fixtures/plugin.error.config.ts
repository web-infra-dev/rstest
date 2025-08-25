import { defineConfig } from '@rstest/core';

export default defineConfig({
  plugins: [
    {
      name: 'test',
      setup: (_api) => {
        throw new Error('plugin setup error');
      },
    },
  ],
});
