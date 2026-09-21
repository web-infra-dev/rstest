export default {
  name: 'selection',
  reporters: [
    'default',
    ['../../reporter/fixtures/contract-reporter.mjs', { marker: 'selection' }],
  ],
};
