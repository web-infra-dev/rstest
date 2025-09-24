import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: { patterns: ['**/aaa/**'], override: true },
});
