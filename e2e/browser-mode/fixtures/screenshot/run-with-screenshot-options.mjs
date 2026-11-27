import { loadConfig } from '@rstest/core';
import { createRstest } from '@rstest/core/api';

const config = await loadConfig({ path: 'rstest.keep-failures.config.mts' });
const rstest = await createRstest({ config });
const result = await rstest.run({
  filters: ['tests/failure.test.ts'],
  browser: {
    screenshotFailures: JSON.parse(process.argv[2]),
    providerOptions: process.env.CI ? { launch: { channel: 'chrome' } } : {},
  },
});
process.exitCode =
  result.status === 'passed' && result.summary.tests.total === 1 ? 0 : 1;
