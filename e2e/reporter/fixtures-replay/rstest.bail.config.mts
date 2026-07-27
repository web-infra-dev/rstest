import { replayConfig } from './replayConfig';

export default replayConfig({
  include: ['bail.test.ts'],
  // Elides every task after the first failure, so the replay is forced to
  // agree with the live runner about what a bail-elided task reports.
  bail: 1,
});
