export default {
  name: 'contract',
  include: ['fixtures/agent-md-pass/*.test.ts'],
  reporters: process.env.RSTEST_BARE_REPORTER
    ? [class InvalidReporter {}]
    : [['./fixtures/contract-reporter.mjs', { marker: 'custom-options' }]],
};
