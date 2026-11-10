import { defineConfig } from '@rstest/core';
import shared from './rstest.shared.config.mts';

export default defineConfig({
  ...shared,
  include: ['./index.test.ts', './imports.test.ts', './dynamic.test.ts'],
  globalSetup: ['./global-setup-unused.ts', './global-setup.ts'],
  setupFiles: [],
});
