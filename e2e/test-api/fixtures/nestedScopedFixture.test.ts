import { describe, test } from '@rstest/core';

describe('nested scoped fixture', () => {
  const nestedTest = test.extend('port', { scope: 'worker' }, 5000);

  nestedTest('does not run', () => {});
});
