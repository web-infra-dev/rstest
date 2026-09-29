import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['src/index.test.ts', 'test/{array,date,string}.test.ts'],
  setupFiles: ['./rstest.setup.ts', './shared.setup.ts'],
  pool: { type: 'forks' },
  coverage: {
    enabled: true,
    provider: 'istanbul',
    include: ['src/index.ts'],
    reporters: ['json'],
  },
});
