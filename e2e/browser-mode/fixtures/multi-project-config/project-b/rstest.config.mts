import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../../ports';

export default defineConfig({
  name: 'project-b',
  include: ['tests/**/*.test.ts'],
  // Divergent per-project resolve config that only project-b's tests use. If
  // project-b's files were compiled inside project-a's environment (the old
  // shared manifest), `@only-b` would be unresolved -> "Module not found". This
  // is the deterministic trigger for
  // https://github.com/web-infra-dev/rstest/issues/1473.
  resolve: {
    alias: {
      '@only-b': fileURLToPath(new URL('./only-b.ts', import.meta.url)),
    },
  },
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-project-config'],
  },
});
