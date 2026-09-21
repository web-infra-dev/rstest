import { replayConfig } from './replayConfig';
import { LifecycleRecorder } from './lifecycleRecorder';

export default replayConfig({
  include: ['lifecycle.test.ts'],
  reporters: [
    new LifecycleRecorder(),
    ['../fixtures/contract-reporter.mjs', { marker: 'replay' }],
    'blob',
  ],
});
