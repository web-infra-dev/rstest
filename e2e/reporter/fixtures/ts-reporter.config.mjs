export default {
  include: ['fixtures/agent-md-pass/*.test.ts'],
  reporters: [['./fixtures/ts-reporter', { marker: 'ts' }]],
};
