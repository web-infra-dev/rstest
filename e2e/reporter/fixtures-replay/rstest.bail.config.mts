import { replayConfig } from './replayConfig';

export default replayConfig({
  // Two files on one worker: `bail.test.ts` fails first, which both elides its
  // remaining in-file tasks and trips the worker's cross-file bail check, so
  // `bailSecond` is skipped before `onTestFileStart` ever fires. The cold
  // scheduler orders new files by size (descending), which keeps the larger
  // `bail.test.ts` first; on a warm cache the failed-first rule does the same.
  include: ['bail.test.ts', 'bailSecond.test.ts'],
  bail: 1,
  pool: { maxWorkers: 1 },
});
