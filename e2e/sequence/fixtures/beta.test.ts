import { expect, rs, test } from '@rstest/core';
import { bigPayloadSize } from './bigHelper';

if (process.env.SEQ_SLOW_IMPORT === '1') {
  rs.useFakeTimers();
  rs.setSystemTime(0);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  rs.useRealTimers();
}

if (process.env.SEQ_IMPORT_FAIL === '1') {
  throw new Error('intentional module loading failure');
}

// Imports a large helper, so its emitted bundle is by far the biggest entry.
// On a cold cache this pushes it to the front (size-desc ordering) even though
// 'beta' sorts after 'alpha' alphabetically.
test('beta', () => {
  console.log('SEQ:beta');
  expect(bigPayloadSize).toBeGreaterThan(0);
});
