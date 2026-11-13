import { defineConfig } from '@rstest/core';
import { BROWSER_TEST_TIMEOUT, ciChromeEntry } from '../ports';

// Three projects with one chromium instance each; a distinct (otherwise
// irrelevant) `launch.timeout` gives each its own launch key, so one run plans
// three browser launches. `pool.maxWorkers` is passed on the command line.
const ciLaunch = ciChromeEntry().providerOptions?.launch ?? {};

const project = (name: string, timeout: number) => ({
  name,
  browser: {
    enabled: true,
    provider: 'playwright' as const,
    headless: true,
    instances: [
      {
        browserName: 'chromium' as const,
        providerOptions: { launch: { ...ciLaunch, timeout } },
      },
    ],
  },
  include: [`tests/${name}.test.ts`],
  testTimeout: BROWSER_TEST_TIMEOUT,
});

export default defineConfig({
  projects: [project('a', 30_001), project('b', 30_002), project('c', 30_003)],
});
