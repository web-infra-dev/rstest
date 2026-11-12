import { defineConfig } from '@rstest/core';
import { BROWSER_TEST_TIMEOUT, ciChromeEntry } from '../ports';

// A mixed headed + headless run under `pool.maxWorkers: 1`: the two projects
// run on different lanes but share one file budget, so their copies of the
// test file never overlap. Chromium for both keeps the shape runnable with a
// single installed engine.
const project = (name: string, headless: boolean) => ({
  name,
  browser: {
    enabled: true,
    provider: 'playwright' as const,
    headless,
    instances: [{ browserName: 'chromium' as const, ...ciChromeEntry() }],
  },
  include: ['tests/window.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});

export default defineConfig({
  projects: [project('headed', false), project('headless', true)],
  pool: { maxWorkers: 1 },
});
