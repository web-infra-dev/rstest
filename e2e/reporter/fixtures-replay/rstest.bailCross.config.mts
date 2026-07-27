import { replayConfig } from './replayConfig';

export default replayConfig({
  // Two files on one worker: `bailFirst` fails, so the worker's cross-file
  // bail check skips `bailSecond` before `onTestFileStart` ever fires — the
  // skipped file reports a result with no file window.
  include: ['bailFirst.test.ts', 'bailSecond.test.ts'],
  bail: 1,
  pool: { maxWorkers: 1 },
});
