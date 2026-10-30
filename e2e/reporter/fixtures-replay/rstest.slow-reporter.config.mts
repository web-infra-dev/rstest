import { setTimeout } from 'node:timers/promises';
import { defineConfig } from '@rstest/core';

const events: string[] = [];
let pendingResults = 0;

export default defineConfig({
  include: ['lifecycle.test.ts'],
  reporters: [
    'dot',
    {
      async onTestCaseResult(result) {
        pendingResults++;
        await setTimeout(20);
        events.push(`case:${result.name}`);
        pendingResults--;
      },
      onTestFileResult() {
        events.push(`file:${pendingResults}`);
      },
      onTestRunEnd() {
        events.push(`run:${pendingResults}`);
        console.log(`__RSTEST_SLOW_REPORTER__${JSON.stringify(events)}__END__`);
      },
    },
  ],
});
