import { defineConfig } from '@rstest/core';
import shared, { environment } from './rstest.shared.config.mts';

export default defineConfig({
  ...shared,
  include: [
    './index.test.ts',
    ...(environment === 'happy-dom'
      ? ['./happy-imports.test.ts', './happy-dynamic.test.ts']
      : ['./imports.test.ts', './dynamic.test.ts']),
  ],
  globalSetup: [
    './global-setup-unused.ts',
    environment === 'happy-dom'
      ? './global-setup-happy.ts'
      : './global-setup.ts',
  ],
  setupFiles: [],
});
