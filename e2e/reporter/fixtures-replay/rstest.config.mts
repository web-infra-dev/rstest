import { setTimeout } from 'node:timers/promises';
import { replayConfig } from './replayConfig';

export default replayConfig({
  include: ['lifecycle.test.ts'],
  extraReporters: [
    ['../fixtures/contract-reporter.mjs', { marker: 'replay' }],
    {
      async onTestCaseResult() {
        // Keep result delivery backlogged while the suite's afterAll runs.
        await setTimeout(100);
      },
    },
  ],
});
