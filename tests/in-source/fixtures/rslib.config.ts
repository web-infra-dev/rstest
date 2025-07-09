import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      bundle: false,
      format: 'esm',
    },
  ],
  source: {
    define: {
      'import.meta.rstest': false,
    },
  },
});
