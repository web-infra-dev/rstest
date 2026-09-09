import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'lint',
  include: ['<rootDir>/*.test.ts'],
});
