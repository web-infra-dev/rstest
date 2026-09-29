import { defineConfig } from '@rstest/core';

export default defineConfig({
  globals: true,
  include: ['./mock.test.js'],
});
