import { defineConfig } from '@rstest/core';
import base from './rstest.config.mts';

export default defineConfig({
  ...base,
  include: ['restore-error/**/*.test.ts'],
});
