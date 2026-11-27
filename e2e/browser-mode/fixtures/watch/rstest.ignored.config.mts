import { defineConfig } from '@rstest/core';
import base from './rstest.config.mts';

export default defineConfig({
  ...base,
  tools: {
    rspack: {
      watchOptions: { ignored: (file) => file.endsWith('.ignored.ts') },
    },
  },
});
