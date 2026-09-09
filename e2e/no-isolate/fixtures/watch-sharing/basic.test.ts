import { test } from '@rstest/core';
import { marker } from './shared';

test('surfaces the current shared module value', () => {
  // Printed to stdout (console interception disabled) so the e2e can assert the
  // rerun observed the rebuilt value.
  console.log(`SHARED_MARKER=${marker}`);
});
