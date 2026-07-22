import { expect, test } from '@rstest/core';
import { getValue } from './consumer';

// No mock in this file. If b-mock runs first, its mock of dep must NOT leak
// into this file — neither directly nor through the cached consumer.
test('a-warmup: sees real dep', () => {
  expect(getValue()).toBe('REAL');
});
