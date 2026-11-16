import { resolve } from 'node:path';
import { defineConfig } from '@rstest/core';
import { BROWSER_TEST_TIMEOUT, ciChromeEntry } from '../ports';

// `a` launches fine; `b`'s browser cannot start. With one worker the pool
// reaches `b` only after `a` finished, so the failure surfaces mid-run. Only
// `a` takes the CI chrome channel: `b` must keep its missing executable.
const project = (name: string, launch: Record<string, unknown>) => ({
  name,
  browser: {
    enabled: true,
    provider: 'playwright' as const,
    headless: true,
    instances: [
      {
        browserName: 'chromium' as const,
        providerOptions: { launch },
      },
    ],
  },
  include: [`tests/${name}.test.ts`],
  testTimeout: BROWSER_TEST_TIMEOUT,
});

export default defineConfig({
  pool: { maxWorkers: 1 },
  projects: [
    project('a', ciChromeEntry().providerOptions?.launch ?? {}),
    project('b', {
      executablePath: resolve('nonexistent-browser-binary'),
    }),
  ],
});
