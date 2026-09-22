import { replayConfig } from './replayConfig';

export default replayConfig({
  include: ['lifecycle.test.ts'],
  extraReporters: [['../fixtures/contract-reporter.mjs', { marker: 'replay' }]],
});
