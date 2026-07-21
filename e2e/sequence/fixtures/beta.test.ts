import { expect, test } from '@rstest/core';
import { bigPayloadSize } from './bigHelper';

// Imports a large helper, so its emitted bundle is by far the biggest entry.
// On a cold cache this pushes it to the front (size-desc ordering) even though
// 'beta' sorts after 'alpha' alphabetically.
test('beta', () => {
  console.log('SEQ:beta');
  expect(bigPayloadSize).toBeGreaterThan(0);
});
