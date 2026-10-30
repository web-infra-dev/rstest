import { setTimeout } from 'node:timers/promises';
import { LifecycleRecorder } from './lifecycleRecorder';
import { replayConfig } from './replayConfig';

export default replayConfig({
  include: ['lifecycle.test.ts'],
  reporters: [
    new LifecycleRecorder(),
    'blob',
    {
      async onTestCaseResult() {
        // Keep result delivery backlogged while the suite's afterAll runs.
        await setTimeout(100);
      },
    },
  ],
});
